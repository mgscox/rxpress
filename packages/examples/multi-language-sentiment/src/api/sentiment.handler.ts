import type { RPCConfig } from 'rxpress';
import { grpc } from 'rxpress';
import { z } from 'zod';

const bodySchema = z.object({
  text: z.string().min(1, 'text is required'),
  language: z.string().optional(),
  backend: z.enum(['python', 'go']).optional().default('python'),
});

const serviceLookup: Record<string, string> = {
  python: 'python-sentiment',
  go: 'go-sentiment',
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const handler: RPCConfig = {
  type: 'api',
  method: 'POST',
  path: '/api/sentiment',
  name: 'Sentiment (Multi-language gRPC)',
  description: 'Delegates sentiment analysis to the selected gRPC bridge adapter',
  bodySchema: bodySchema as any,
  kind: 'local',
  handler: async (req, ctx) => {
    const validated = bodySchema.parse(req.body ?? {});
    const backend = (validated.backend ?? 'python').toLowerCase();
    const service = serviceLookup[backend];

    if (!service) {
      return {
        status: 400,
        body: {
          message: `Unsupported backend "${backend}"`,
          supported: Object.keys(serviceLookup),
        },
      };
    }

    const requestBody = {
      text: validated.text,
      language: validated.language,
    };

    try {
      const result = await grpc.invoke({
        binding: {
          handlerName: 'sentiment.analyse',
          service,
          timeoutMs: 10_000,
        },
        method: 'api',
        input: {
          body: requestBody,
          query: req.query,
          params: req.params,
          headers: req.headers,
          user: (req as any).user,
        },
        meta: {
          run_id: ctx.run?.id,
          http_method: req.method,
          route: handler.path,
          path: req.path,
          url: req.originalUrl,
          trace_id: ctx.span?.spanContext().traceId,
          span_id: ctx.span?.spanContext().spanId,
          trace_flags: ctx.span?.spanContext().traceFlags,
          backend,
        },
      });

      const output = (result.output ?? {}) as Record<string, unknown>;
      const status = typeof output.status === 'number' ? output.status : 200;
      const responseBody = (isRecord(output.body) ? output.body : output.body === undefined ? output : { result: output.body }) as Record<string, unknown>;

      return {
        status,
        body: {
          ...(responseBody ?? {}),
          backend,
        },
      };
    }
    catch (error) {
      ctx.logger.error?.('sentiment.grpc.error', {
        backend,
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        status: 502,
        body: {
          message: `Sentiment backend "${backend}" failed`,
          backend,
        },
      };
    }
  },
};

export default handler;
