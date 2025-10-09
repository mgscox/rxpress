import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import * as z from 'zod';
import { rxpress, ConfigService, helpers } from 'rxpress';
import type { RPCConfig, EventConfig, Request } from 'rxpress';
import { DiagLogLevel } from '@opentelemetry/api';

const routes: RPCConfig[] = [
  {
    type: 'api',
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
  }
];

const inlineEvents: EventConfig[] = [
  {
    subscribe: ['another-emit'],
    handler: async (input, { logger }) => {
      const payload = input as { status: string; body: Record<string, unknown> };
      logger.info(`Inline configured event triggered`, payload);
    },
  },
];

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
    },
    logger: helpers.simplelLogger,
    kv: helpers.createMemoryKv('example_server', false),
  });

  rxpress.addEvents(inlineEvents);
  await rxpress.load({ eventDir: join(__dirname, 'events') });
  rxpress.addHandlers(routes);

  const { server, port: boundPort } = await rxpress.start({ port });
  const host = server.address() as AddressInfo;
  helpers.simplelLogger.info(`rxpress example server is running http://${host?.address || 'localhost'}:${boundPort}`);
}

main()
  .catch(async (error) => {
    console.error('Fatal error starting server:', error);
  })
  .finally(async () => {
    await rxpress.stop(true);
  });
