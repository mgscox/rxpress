import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import * as z from 'zod';
import { rxpress, ConfigService, helpers } from 'rxpress';
import type { RPCConfig, EventConfig, Request } from 'rxpress';

const routes: RPCConfig[] = [
  {
    type: 'api',
    method: 'GET',
    path: '/api/v1/example',
    middleware: [],
    emits: ['do-log', 'another-emit'],
    strict: false,                              // strict is false - response will be sent to client even if responseSchema fails checks
    responseSchema: {
      200: z.object({ response: z.string() }),  // this does NOT match return object in Handler function ('response' vs 'result') - will cause a warning
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
      emit({topic: 'another-emit', data: hanlderResult})
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
      emit({topic: 'another-emit', data: hanlderResult})
      return hanlderResult;
    },
  },
];

const inlineEvents: EventConfig[] = [
  {
    subscribe: ['another-emit'],
    handler: async (input, {logger}) => {
      const payload = input as { status: string; body: Record<string, unknown> };
      logger.info(`Inline configured event triggered`, payload);
    },
  },
];

async function main() {
  const port = Number.parseInt(ConfigService.env('PORT', '3002'), 10);
  const __dirname = ConfigService.getDirname(import.meta.url);
  rxpress.init({
    config: {
      port,
      loadEnv: false,
      processHandlers: true,
    },
    logger: helpers.simplelLogger,
    kv: helpers.createMemoryKv('server', false),
  });

  rxpress.addEvents(inlineEvents);
  await rxpress.load({ eventDir: join(__dirname, 'events') });
  rxpress.addHandlers(routes);

  const { server, port: boundPort } = await rxpress.start({ port });
  const host = server.address() as AddressInfo;
  helpers.simplelLogger.info(`rxpress server is running http://${host.address}:${boundPort}`);
}

main().catch(async (error) => {
  console.error('Fatal error starting server:', error);
  await rxpress.stop(true);
  process.exit(1);
});
