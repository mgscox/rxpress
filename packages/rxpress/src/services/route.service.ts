import express, { NextFunction, Request, Response } from 'express';
import { Subject } from 'rxjs';
import * as z from 'zod';
import { performance } from 'node:perf_hooks';
import { Counter, Histogram, SpanStatusCode } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';

import { HandlerContext, RequestHandlerMiddleware, RequestMiddleware, RPCConfig, RPCContext, RPCHttpResult, RPCResult, RPCSSEStream, SSESendOptions, rxRequest } from '../types/rpc.types.js';
import { EventService } from './event.service.js';
import { Logger } from '../types/logger.types.js';
import { KVBase } from '../types/kv.types.js';
import { MetricService } from './metrics.service.js';
import { SSEService } from './sse.service.js';
import { createKVPath } from './kv-path.service.js';
import { createRun as createRunScope, releaseRun as releaseRunScope } from './run.service.js';
import { DocumentationService } from './documentation.service.js';
import { GrpcBridgeService } from './grpc.service.js';
import type { GrpcInvokeBinding } from '../types/grpc.types.js';

export namespace RouteService {
  const pubs$: Record<string, Subject<RPCContext>> = {};
  let staticRoutDir: string | undefined;

  const schemaToDescriptor = (schema?: z.ZodTypeAny) => {
    if (!schema) {
      return undefined;
    }

    const typeName = (schema as z.ZodTypeAny & { _def?: { typeName?: string } })._def?.typeName;
    return {
      description: schema.description,
      type: typeName ?? schema.constructor.name ?? 'unknown',
    };
  };

  const resolveResponseSchema = (route: RPCConfig, status: number): z.ZodTypeAny | undefined => {
    if (!route.responseSchema) {
      return undefined;
    }

    if (route.responseSchema && typeof (route.responseSchema as z.ZodTypeAny).parse === 'function') {
      return route.responseSchema as z.ZodTypeAny;
    }

    if (route.responseSchema && typeof route.responseSchema === 'object') {
      return (route.responseSchema as Record<number, z.ZodTypeAny>)[status];
    }

    return undefined;
  };

  const validateResponse = <T>(route: RPCConfig, status: number, payload: T): T => {
    const schema = resolveResponseSchema(route, status);

    if (!schema) {
      return payload as T;
    }

    return schema.parse(payload) as T;
  };

  const getPayload = (param: {
    error: string;
    reason: unknown;
    route: RPCConfig;
    req: Request;
  }) => {
    const { error, reason, route, req } = param;

    if (reason instanceof Error) {
      try {
        reason.message = JSON.parse(reason.message);
      }
      catch {
        /* ignore errors from non-JSON payloads */
      }
    }

    return {
      error,
      reason,
      path: req.path,
      method: req.method,
      route: {
        ...route,
        bodySchema: route.bodySchema 
          ? schemaToDescriptor(route.bodySchema as z.ZodTypeAny)
          : undefined,
        queryParams: route.queryParams 
          ? schemaToDescriptor(route.queryParams as z.ZodTypeAny)
          : undefined,
        responseSchema: route.responseSchema
          ? route.responseSchema instanceof z.ZodObject
            ? schemaToDescriptor(route.responseSchema as z.ZodTypeAny)
            : Object.entries(route.responseSchema as Record<number, z.ZodTypeAny>).map(([code, schema]) => ({
              statusCode: code,
              schema: schemaToDescriptor(schema),
            }))
          : undefined,
      },
    };
  };

  const handleError = (param: {
    payload: Record<string, unknown>;
    code?: number;
    route: RPCConfig;
    res: Response;
  }): boolean => {
    const { payload, code, route, res } = param;

    if (route.strict || code === 500) {
      
      switch (route.type) {
        case 'api':
          res.status(code || 422);
          res.json(payload);
          return true;
        case 'http':
          res.status(code || 422);
          res.send(payload);
          return true;
        case 'sse':
        default:
          return false;
      }

    }

    return false;
  };

  let requestCounter: Counter;
  let requestDuration: Histogram;
  let requestLatency: Histogram;

  const isRecord = (value: unknown): value is Record<string, unknown> => {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  };

  const isGrpcRoute = (route: RPCConfig): route is RPCConfig & { kind: 'grpc'; grpc: GrpcInvokeBinding } => {
    return (route as Record<string, unknown>).kind === 'grpc';
  };

  const sanitizeHeaders = (headers: unknown): Record<string, string> | undefined => {
    if (!isRecord(headers)) {
      return undefined;
    }

    return Object.entries(headers).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === 'string') {
        acc[key] = value;
      }

      return acc;
    }, {});
  };

  const buildGrpcMeta = (route: RPCConfig, req: Request, runId: string, span?: Span) => {
    const meta: Record<string, unknown> = {
      run_id: runId,
      http_method: req.method,
      route: route.path,
      path: req.path,
      url: req.originalUrl,
    };

    if (span) {
      const ctx = span.spanContext();
      meta.trace_id = ctx.traceId;
      meta.span_id = ctx.spanId;
      meta.trace_flags = ctx.traceFlags;
    }

    return meta;
  };

  const buildGrpcInput = (req: Request) => {
    return {
      body: req.body,
      query: req.query,
      params: req.params,
      headers: req.headers,
      user: (req as rxRequest).user,
    };
  };

  const normalizeGrpcResult = (route: RPCConfig, res: Response, payload: Record<string, unknown>): RPCResult => {
    const headers = sanitizeHeaders(payload.headers);

    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        res.setHeader(key, value);
      }
    }

    const status = typeof payload.status === 'number' ? payload.status : undefined;
    const mime = typeof payload.mime === 'string' ? payload.mime : undefined;

    const reserved = new Set(['status', 'headers', 'mime']);
    let bodyCandidate = payload.body;

    if (bodyCandidate === undefined && isRecord(payload)) {
      bodyCandidate = Object.fromEntries(Object.entries(payload).filter(([key]) => !reserved.has(key)));
    }

    if (route.type === 'api') {
      const body = isRecord(bodyCandidate)
        ? bodyCandidate
        : { value: bodyCandidate ?? null };
      return { status, body };
    }

    if (route.type === 'http') {
      if (Buffer.isBuffer(bodyCandidate)) {
        return { status, body: bodyCandidate.toString('utf8'), mime };
      }

      if (typeof bodyCandidate === 'string') {
        return { status, body: bodyCandidate, mime };
      }

      return { status, body: JSON.stringify(bodyCandidate ?? ''), mime: mime ?? 'application/json' };
    }

    throw new Error('gRPC routes currently support HTTP/API handlers only.');
  };

  function updateHttpMetrics(statusCode: number, initiatedTime: number, startTime: number, attributes: Record<string, string | number>) {
    const now = performance.now();
    attributes.status = String(statusCode);
    requestCounter?.add(1, attributes);
    requestLatency?.record(startTime - initiatedTime, attributes);
    requestDuration?.record(now - startTime, attributes);
  }

  export function start(config: {staticRoutDir?: string}) {
    staticRoutDir = config.staticRoutDir;
    MetricService.ready$.then(() => {
      requestCounter = MetricService.addMetrics<Counter>({
        type: 'counter',
        name: 'rxpress_server_requests_total', 
        description: 'Total HTTP requests handled by rxpress routes', 
        unit: '1' 
      });
      requestDuration = MetricService.addMetrics<Histogram>({
        type: 'histogram',
        name: 'rxpress_server_request_duration_ms', 
        description: 'Processing time for rxpress handlers', 
        unit: 'ms' 
      });
      requestLatency = MetricService.addMetrics<Histogram>({
        type: 'histogram',
        name: 'rxpress_server_request_latency_ms', 
        description: 'Latency to start processing rxpress handlers', 
        unit: 'ms' 
      })
    })
  }

  async function runHandler(param: { req: rxRequest; res: Response; route: RPCConfig; logger: Logger; kv: KVBase; span?: Span }) {
    const { req, res, route, logger, kv, span } = param;
    const attributes: Record<string, string | number> = {
      method: route.method,
      type: route.type,
      path: route.path.toLowerCase(),
    };

    const run = await createRunScope(kv);
    const kvPath = createKVPath(kv);
    let result: RPCResult | undefined;
    let handlerError: unknown;
    const sseFormat = route.type === 'sse' ? route.streamFormat ?? 'raw' : 'raw';
    const responseSchema = route.type === 'sse' && route.responseSchema && typeof (route.responseSchema as z.ZodTypeAny).parse === 'function'
      ? (route.responseSchema as z.ZodTypeAny)
      : undefined;
    const sseService: SSEService = new SSEService(req, res, sseFormat, responseSchema);

    const handlerContext = {
      emit: (param) => EventService.emit({ ...param, run, traceContext: span?.spanContext() }),
      kv,
      kvPath,
      logger,
      run,
      span,
    } as HandlerContext<typeof route.type>;

    try {
      if (route.bodySchema) {
        try {
          route.bodySchema.parse(req.body);
        }
        catch (reason) {
          const payload = getPayload({
            error: 'Invalid request body payload',
            reason: `${reason}`,
            route,
            req,
          });

          if (handleError({ payload, route, res })) {
            return;
          }
        }
      }

      if (route.queryParams) {
        try {
          route.queryParams.parse(req.params);
        }
        catch (reason) {
          const payload = getPayload({
            error: 'Invalid request parameters',
            reason: `${reason}`,
            route,
            req,
          });

          if (handleError({ payload, route, res })) {
            return;
          }
        }
      }

      if (route.type === 'sse') {
        sseService.sendSSEHeaders();
        const stream: RPCSSEStream = {
          send: (payload: unknown, options?: SSESendOptions) => sseService.emitSsePayload(payload, options),
          error:  (payload: unknown, options?: SSESendOptions) => sseService.emitSseError(payload, options),
        };
        (handlerContext as HandlerContext<'sse'>).stream = stream;
      }

      try {
        if ('staticRoute' in route) {
          const { staticRoute } = route;
          result = await new Promise<RPCResult>((resolve) => {
            const options = {
              root: staticRoutDir,
              ...staticRoute.options,
            };
            res.sendFile(staticRoute.filename, options, (err) => {
              if (err) {
                resolve({ status: 404, body: 'Resource not found' });
              }
              else {
                res.end();  // close response so later logic knows not send further response
                resolve({status: 200, body: 'not-used'})
              }
            })
          })
        }
        else if (isGrpcRoute(route)) {
          if (!route.grpc?.handlerName) {
            throw new Error(`gRPC route ${route.path} missing handlerName`);
          }

          if (!GrpcBridgeService.isEnabled()) {
            throw new Error('gRPC bridge not initialised – enable rxpress config.grpc to use kind:"grpc" routes.');
          }

          const invokeResult = await GrpcBridgeService.invoke({
            binding: route.grpc,
            method: route.type,
            input: buildGrpcInput(req),
            meta: buildGrpcMeta(route, req, run.id, span),
          });

          const payload = isRecord(invokeResult.output) ? invokeResult.output : {};
          result = normalizeGrpcResult(route, res, payload);
        }
        else if ('handler' in route) {
          if (route.type === 'sse') {
            result = await route.handler(req, handlerContext as HandlerContext<'sse'>) as RPCResult | undefined;
          }
          else if (route.type === 'api') {
            result = await route.handler(req, handlerContext as HandlerContext<'api'>) as RPCResult | undefined;
          }
          else {
            result = await route.handler(req, handlerContext as HandlerContext<'http'>) as RPCResult | undefined;
          }
        }
        else {
          throw new Error('Route is missing a handler');
        }
      }
      catch (error) {
        handlerError = error;
      }

      if (sseService.isSseRoute) {
        if (handlerError) {
          res.statusCode = 500;
          logger.error?.(`SSE handler failed for ${route.path}: ${handlerError}`);
          sseService.emitSseError(handlerError);
        }
        else if (result !== undefined) {
          logger.debug?.(`SSE handler for ${route.path} returned a value; ignoring.`);
        }

        sseService.closeStream();
        return;
      }
      else if (handlerError) {
        throw handlerError;
      }
      else if (!result) {
        throw new Error('RPC handler returned no result');
      }

      if (!res.closed) {
        const status = result.status ?? 200;
        let validatedBody = result.body;

        try {
          validatedBody = validateResponse(route, status, result.body);
        }
        catch (reason) {
          const payload = getPayload({
            error: 'Invalid API Response',
            reason: `${reason}`,
            route,
            req,
          });

          if (handleError({ payload, route, res })) {
            return;
          }
        }

        res.status(status);

        switch (route.type) {
          case 'http': {
            const httpResult = result as RPCHttpResult;
            res.contentType(httpResult.mime || 'text/html');
            res.send(`${validatedBody}`);
            break;
          }

          case 'api': {
            res.contentType('application/json');
            res.json(validatedBody);
            break;
          }

          case 'sse':
            throw `SSE - condition should never occur`;
          default:
            break;
        }
      }
    }
    catch (reason) {

      if (sseService.isSseRoute) {
        res.statusCode = res.statusCode >= 400 ? res.statusCode : 500;
        sseService.emitSseError(reason);
      }
      else {
        res.status(500);
        const payload = getPayload({
          error: 'Invalid API response',
          reason: `${reason}`,
          route,
          req,
        });
        handleError({ payload, code: 500, route, res });
      }

    }

    finally {
      if (sseService.isSseRoute) {
        sseService.closeStream();
      }

      updateHttpMetrics(res.statusCode, req._rxpress.trace.initiated, req._rxpress.trace.start, attributes);

      try {
        await releaseRunScope(run.id);
      }
      catch (error) {
        logger.error?.('Failed to release run scope', { error: `${error}` });
      }
    }
  }

  export function addHandler(route: RPCConfig, logger: Logger, kv: KVBase): express.Router {
    const now = performance.now();

    const middlewareWrapper = (middleware: RequestHandlerMiddleware) => {
      return async (req: Request, res: Response, next: NextFunction) => {
        const middleReq = {
          ...req,
          logger,
          kv,
          emit: EventService.emit,
        } as RequestMiddleware;

        try {
          await middleware(middleReq, res, next);
        }
        catch (err) {
          next(err)
        }
      }
    }

    const router = express.Router();
    const signature =
      `${route.flow ? `${route.flow}_` : ""}${route.method}::${route.path}`.toLowerCase();
    const pub$ = new Subject<RPCContext>();
    const method = route.method.toLowerCase() as keyof typeof router & ("get" | "post" | "put" | "delete");
    pubs$[signature] = pub$;
    router[method](route.path, ...(route.middleware?.map(m => middlewareWrapper(m)) || []), (req, res) => {
      // capture the active ctx at the moment the request hits Express
      const activeCtx = MetricService.getContext().active();
      const rxReq = (req as rxRequest);
      rxReq._rxpress = {
        trace: {
          initiated: now,
          start: now,     // will be overwritten when handler runs
        } 
      }
      pub$.next({ req: rxReq, res, ctx: activeCtx });
    });
    pub$.subscribe({
      next: ({ req, res, ctx }) => {
        req._rxpress.trace.start = performance.now();
        const tracer = MetricService.getTracer();

        // Run inside the captured context so downstream work sees the same trace
        MetricService.getContext().with(ctx, () => {
          tracer.startActiveSpan(`${req.method} ${route.path}`, async (span: Span) => {
            // --- Recommended HTTP attributes (newer naming)
            const ua = req.headers["user-agent"];
            const hostHeader = req.headers.host ?? "";
            const protocol = req.protocol; // "http" | "https"
            const clientIp =
              (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() 
              || (req.socket?.remoteAddress ?? "");

            span.setAttributes({
              // Request
              "http.request.method": req.method,
              "url.scheme": protocol,
              "server.address": req.hostname || hostHeader.split(":")[0],
              "server.port": Number(req.socket?.localPort) || undefined,
              "url.path": req.path,
              "url.query": req.url.includes("?") ? req.url.split("?")[1] : undefined,
              "http.route": route.path, // templated route
              "user_agent.original": ua || undefined,
              "client.address": clientIp || undefined,

              // Helpful low-cardinality identifiers
              "enduser.id": (req as rxRequest).user?.id ?? undefined,
              "http.request_id": (req.headers["x-request-id"] as string) || undefined,

              // Legacy compatibility
              "http.method": req.method,
              "http.target": req.originalUrl,
              "http.user_agent": ua || undefined
            });

            // Attach response finalization logic once, so we can set status/body sizes.
            const onFinish = () => {
              res.removeListener("finish", onFinish);
              res.removeListener("close", onFinish);

              // Status / sizes
              span.setAttributes({
                "http.response.status_code": res.statusCode,
                "http.response.body.size": Number(res.getHeader("content-length")) || undefined,
              });

              // Mark errors based on status code if upstream didn’t already set an error
              if (res.statusCode >= 500) {
                span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${res.statusCode}` });
              } 
              else {
                span.setStatus({ code: SpanStatusCode.OK });
              }

              span.end();
            };

            res.once("finish", onFinish);
            res.once("close", onFinish);

            try {
              await runHandler({ req, res, route, logger, kv, span });
            } 
            catch (error) {
              // Record exception as an event and set status
              span.recordException(error as Error);
              span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
              throw error;
            } 
            finally {
              // If handler ended the response synchronously without triggering finish/close, ensure the span isn’t left open.
              if (res.writableEnded && (span as any)._ended !== true) {
                // safety: end if finish/close didn’t fire for some reason
                onFinish();
              }
            }
          });
        });
      },
    });

    DocumentationService.registerRoute(route);

    return router;
  }

  export const close = () => {
    Object.values(pubs$).forEach((pub) => pub.complete());
  };
}
