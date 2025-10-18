import { join, resolve } from 'node:path';
import { AddressInfo } from 'node:net';
import * as z from 'zod';
import { rxpress, ConfigService, helpers } from 'rxpress';
import type { RPCConfig, EventConfig, Request } from 'rxpress';
import { DiagLogLevel } from '@opentelemetry/api';
import { existsSync, readFileSync } from 'node:fs';
import cors from 'cors';

const ExampleEventSchema = z.object({
  status: z.string(),
  body: z.record(z.string(), z.unknown()),
});
type ExampleEventType = z.infer<typeof ExampleEventSchema>;

const workbenchPath = '/topology.dot';
const routes: RPCConfig[] = [
  {
    type: 'api',
    name: 'API example',
    description: 'Example API handler',
    method: 'GET',
    path: '/api/v1/example',
    middleware: [],
    emits: ['do-log', 'another-emit'],
    strict: false, // strict is false - response will be sent to client even if responseSchema fails checks
    responseSchema: {
      200: z.object({ response: z.string() }), // this does NOT match return object in Handler function ('response' vs 'result') - will cause a warning
    },
    handler: async (req: Request, { emit, logger }) => {
      const payload = {
        level: 'info',
        time: Date.now(),
        msg: `Payload for a "do-log" event emitted from HTTP handler`,
        meta: {
          method: req.method,
          path: req.path,
        },
      };
      logger.info('Logger called: Handled API request', payload.meta);
      emit({ topic: 'do-log', data: payload });

      //HTTP 200 status, with JSON payload (as this is a 'api' hanlder)
      const hanlderResult = { status: 200, body: { result: 'Hello World!' } };
      emit({ topic: 'another-emit', data: hanlderResult });
      return hanlderResult;
    },
  },
  {
    type: 'http',
    name: 'HTTP example',
    description: 'Example web route handler',
    method: 'GET',
    path: '/',
    middleware: [],
    emits: ['do-log', 'another-emit'],
    handler: async (req: Request, { emit, logger }) => {
      const payload = {
        level: 'info',
        time: Date.now(),
        msg: `Payload for a "do-log" event emitted from HTTP handler`,
        meta: {
          method: req.method,
          path: req.path,
        },
      };
      logger.info('Logger called: Handled HTTP request', payload.meta);
      emit({ topic: 'do-log', data: payload });

      //HTTP 200 status, with HTML payload (as this is a 'api' hanlder)
      const hanlderResult = { status: 200, body: '<h1>Hello World!</h1>' };
      emit({ topic: 'another-emit', data: hanlderResult });
      return hanlderResult;
    },
  },
  {
    type: 'http',
    name: 'Graphviz',
    description: 'Web handler for event vizualisation',
    method: 'GET',
    path: '/graphviz',
    middleware: [],
    emits: [],
    handler: async () => {
      const file = resolve(`public/graphviz.html`);

      if (!existsSync(file)) {
        return {status: 404, body: `File not found: ${file}`};
      }

      const handlerResult = { status: 200, body: readFileSync(file, {encoding: 'utf-8'}), mime: 'text/html' };
      return handlerResult;
    },
  }
];

const inlineEvent: EventConfig<ExampleEventType> = {
  name: 'Another emit handler',
  description: 'Example event handler',
  subscribe: ['another-emit'],
  strict: true,
  schema: ExampleEventSchema,
  handler: async (input, { logger }) => {
    logger.info(`Inline configured event triggered`, { status: input.status, body: input.body });
  },
};

async function main() {
  const port = Number.parseInt(ConfigService.env('PORT', '3002'), 10);
  const __dirname = ConfigService.getDirname(import.meta.url);
  const metricsEndpoint = ConfigService.env(
    'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
    'http://localhost:4318/v1/metrics',
  );
  const tracesEndpoint = ConfigService.env(
    'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
    'http://localhost:4318/v1/traces',
  );

  rxpress.init({
    config: {
      port,
      loadEnv: false,
      processHandlers: true,
      metrics: {
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: metricsEndpoint,
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: tracesEndpoint,
        console_log: {
          level: DiagLogLevel.ALL
        }
      },
      documentation: {
        enabled: true,
        title: 'Example API',
        version: '2.0.0',
        path: '/openapi.json',
        description: 'Public endpoints exposed by the Example service',
      },
      session: {
        secret: 's3Cur3',
        name: 'sessionId',
        maxAge: 24 * 60 * 60 * 1000,
      },
      workbench: { path: workbenchPath }
    },
    logger: helpers.simplelLogger,
    kv: helpers.createMemoryKv('example_server', false),
  });
  rxpress.use( cors() );
  rxpress.addEvents(inlineEvent);
  await rxpress.load({ eventDir: join(__dirname, 'events') });
  rxpress.addHandlers(routes);

  const { server, port: boundPort } = await rxpress.start({ port });
  const host = server.address() as AddressInfo;
  helpers.simplelLogger.info(`rxpress example server is running http://${host?.address || 'localhost'}:${boundPort}`);
}

main().catch(async (error) => {
  console.error('Fatal error starting server:', error);
  await rxpress.stop(true);
  process.exit(1);
});
