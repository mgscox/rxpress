import express, { type RequestHandler, type ErrorRequestHandler } from 'express';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { globSync } from 'glob';
import helmet from 'helmet';
import session from 'cookie-session';

import {
  CronConfig,
  EventConfig,
  RPCConfig,
  RxpressConfig,
  Logger,
  KVBase,
  BufferLike,
  HelmetOptions,
  RxpressStartConfig,
  ReactiveConfig,
} from './types/index.js';

import { EventService } from './services/event.service.js';
import { RouteService } from './services/route.service.js';
import { CronService } from './services/cron.service.js';
import { MetricService } from './services/metrics.service.js';
import { ConfigService } from './services/config.service.js';
import { WSSService } from './services/wss.service.js';
import { NextService } from './services/next.service.js';
import { DocumentationService } from './services/documentation.service.js';
import { TopologyService } from './services/topology.service.js';
import { GrpcBridgeService } from './services/grpc.service.js';
import { ReactiveService } from './services/reactive.service.js';
import { createKVPath } from './services/kv-path.service.js';

const createHelmetMiddleware = helmet as unknown as (options?: HelmetOptions) => RequestHandler;

export namespace rxpress {
  let app: express.Express | null = null;
  let server: http.Server | null = null;
  let activeLogger: Logger | null = null;
  let activeKv: KVBase | null = null;
  let activeConfig: RxpressConfig | null = null;
  let hostname = '0.0.0.0';
  let nextReady: Promise<void> | undefined;
  let inlineRouteCounter = 0;
  let inlineEventCounter = 0;
  let inlineCronCounter = 0;
  let inlineReactiveCounter = 0;

  const ensureInitialized = () => {
    if (!app || !activeLogger || !activeKv || !activeConfig) {
      throw new Error('rxpress.init() must be called before invoking this function.');
    }
  };

  export function init(param: { config: RxpressConfig; logger: Logger; kv: KVBase }): void {
    const { config, logger, kv } = param;

    activeConfig = config;
    activeLogger = logger;
    activeKv = kv;
    hostname = config.hostname || hostname;
    TopologyService.clear();

    if (config.rootDir) {
      ConfigService.setRootDir(config.rootDir);
    }

    if (config.loadEnv !== false) {
      ConfigService.loadEnv(config.envFiles);
    }

    DocumentationService.configure(config.documentation);
    GrpcBridgeService.init({ config: config.grpc, logger, kv, emit: EventService.emit });

    if (config.metrics) {
      MetricService.start(config.metrics);
    }

    if (config.processHandlers) {
      addProcessHandlers();
    }

    RouteService.start({ staticRoutDir: config.staticRoutDir });
    app = express();
    const _ = config.servername 
      ? app.set('x-powered-by', config.servername) 
      : app.disable('x-powered-by');
    DocumentationService.attach(app);
    app.use(express.json(config.json));

    if (config.helmet) {
      app.use(createHelmetMiddleware(config.helmet));
    }

    if (config.session) {
      const cconfig = config.session;
      
      if (!cconfig.secret && !cconfig.keys) {
        activeLogger.warn(`[rxpress] cookies not protected against tampering (set "secret" or "keys")`)
      }

      app.use(session(cconfig));
    }

    if (config.workbench?.path) {
      app.get(config.workbench.path, (_req, res) => {
        res.type('text/vnd.graphviz');
        res.send(TopologyService.generateDot());
      });
    }
  }

  export function use(handler: RequestHandler | ErrorRequestHandler): void;
  export function use(path: string | RegExp | Array<string | RegExp>, ...handlers: Array<RequestHandler | ErrorRequestHandler>): void;

  export function use(...args: unknown[]): void {
    ensureInitialized();
    (app!.use as unknown as (...params: unknown[]) => express.Express).apply(app, args);
  }

  export function createServer(port = 3000): Promise<{ server: http.Server; port: number }> {
    ensureInitialized();
    const listenPort = activeConfig?.port ?? port;

    return new Promise((resolve, reject) => {
      const bootstrap = async () => {
        try {
          if (nextReady) {
            await nextReady;
          }

          server = http.createServer(app!);
          server.on('error', reject);
          server.on('listening', () => {
            resolve({ server: server!, port: listenPort });
          });
          WSSService.createWs(server, activeConfig?.wsPath);
          server.listen(listenPort, hostname);
          const wssBroadcastEvent: EventConfig = {
            subscribe: ['SYS::WSS::BROADCAST'],
            handler: async (input: unknown) => {
              const payload = (input === typeof 'BufferLike')
                ? <BufferLike>input
                : JSON.stringify(input);
              WSSService.broadcast(payload);
            },
          };

          TopologyService.registerEvent(wssBroadcastEvent, 'internal:wss-broadcast');
          EventService.add(wssBroadcastEvent, {
            logger: activeLogger!,
            kv: activeKv!,
            emit: EventService.emit,
          });
        }
        catch (error) {
          reject(error);
        }
      };

      bootstrap().catch(reject);
    });
  }

  async function registerEvent(file: string) {
    ensureInitialized();
    const module = await import(pathToFileURL(file).href);
    const config = module.config || module.default;

    if (config) {
      TopologyService.registerEvent(config, `event:${file}`);
      EventService.add(config, { logger: activeLogger!, kv: activeKv!, emit: EventService.emit });
    } 
    else {
      throw new Error(`(EVENT) Missing configuration export: ${file}`);
    }
  }

  async function registerHandler(file: string) {
    ensureInitialized();
    const module = await import(pathToFileURL(file).href);
    const route = module.config || module.default;

    if (route) {
      const label = route.name ?? `${route.method} ${route.path}`;
      TopologyService.registerRoute(route, `route:${label}`);
      const router = RouteService.addHandler(route, activeLogger!, activeKv!);
      app!.use(router);
    } 
    else {
      throw new Error(`(HANDLER) Missing configuration export: ${file}`);
    }
  }

  async function registerCron(file: string) {
    ensureInitialized();
    const module = await import(pathToFileURL(file).href);
    const config = module.config || module.default;

    if (config) {
      const entries = Array.isArray(config) ? config : [config];
      entries.forEach((cron, index) => {
        const label = cron.handler.name || `cron#${index}`;
        TopologyService.registerCron(cron, `cron:${label}`);
      });
      CronService.add(config, { logger: activeLogger!, kv: activeKv! });
    } 
    else {
      throw new Error(`(CRON) Missing configuration export: ${file}`);
    }
  }

  export async function loadEvents(eventDir: string) {
    const eventFiles = globSync('**/*.event.js', { cwd: eventDir, absolute: true });
    await Promise.all(eventFiles.map((file) => registerEvent(file)));
  }

  export function addEvents<T = unknown>(events: EventConfig<T> | EventConfig<T>[]) {
    ensureInitialized();
    const entries = Array.isArray(events) ? events : [events];

    for (const event of entries) {
      const id = `inline-event:${event.name || (`Inline Event ${inlineEventCounter += 1}`)}`;
      TopologyService.registerEvent(event, id);
      EventService.add(event, { logger: activeLogger!, kv: activeKv!, emit: EventService.emit });
    }
  }

  export async function loadHandlers(handlerDir: string) {
    const handlerFiles = globSync('**/*.handler.js', { cwd: handlerDir, absolute: true });
    await Promise.all(handlerFiles.map((file) => registerHandler(file)));
  }

  export function addHandlers(handlers: RPCConfig | RPCConfig[]) {
    ensureInitialized();
    const entries = Array.isArray(handlers) ? handlers : [handlers];

    for (const handler of entries) {
      const label = handler.name ?? `${handler.method} ${handler.path}`;
      const id = `inline-route:${inlineRouteCounter += 1}:${label}`;
      TopologyService.registerRoute(handler, id);
      const router = RouteService.addHandler(handler, activeLogger!, activeKv!);
      app!.use(router);
    }
  }

  export async function loadCrons(cronDir: string) {
    const cronFiles = globSync('**/*.cron.js', { cwd: cronDir, absolute: true });
    await Promise.all(cronFiles.map((file) => registerCron(file)));
  }

  export function addCrons(crons: CronConfig | CronConfig[]) {
    ensureInitialized();
    const entries = Array.isArray(crons) ? crons : [crons];

    entries.forEach((cron) => {
      const label = cron.handler.name ?? `inline-cron#${inlineCronCounter += 1}`;
      TopologyService.registerCron(cron, `inline-cron:${label}`);
      CronService.add(cron, { logger: activeLogger!, kv: activeKv! });
    });
  }

  export async function load(param: { eventDir?: string; handlerDir?: string; cronDir?: string }) {
    const { eventDir, handlerDir, cronDir } = param;

    if (eventDir) {
      await loadEvents(eventDir);
    }

    if (handlerDir) {
      await loadHandlers(handlerDir);
    }

    if (cronDir) {
      await loadCrons(cronDir);
    }
  }

  export async function start(param: RxpressStartConfig) {
    const {validateEvents = true, port} = param;
    await load(param);

    if (validateEvents) {
      const { missingHandlers, unusedHandlers } = TopologyService.validateTopology(['SYS::']);

      if (missingHandlers.length || unusedHandlers.length) {
        const details: string[] = [];

        if (missingHandlers.length) {
          const formatted = missingHandlers
            .map(({ topic, sources }) => `${topic} ← emitted by ${sources.join(', ')}`)
            .join('; ');
          details.push(`unmatched emits: ${formatted}`);
        }

        if (unusedHandlers.length) {
          const formatted = unusedHandlers
            .map(({ topic, sources }) => `${topic} ← handlers ${sources.join(', ')}`)
            .join('; ');
          details.push(`handlers without emit: ${formatted}`);
        }

        throw new Error(`[rxpress] Event validation failed [${details.join(' | ')}] - you can disable this check by setting {"validateEvents": false} (not recommended)`);
      }
    }

    if (activeConfig?.next) {
      nextReady = NextService.configure(app!, activeConfig.next, activeLogger!);
      await nextReady;
    }

    return await createServer(port);
  }

  export async function stop(critical = false): Promise<void> {
    EventService.emit({ topic: 'SYS::SHUTDOWN', data: { critical } });
    EventService.close();
    RouteService.close();
    CronService.close();
    await Promise.all([
      MetricService.stop(),
      NextService.stop(),
      GrpcBridgeService.shutdown(),
    ]).catch((e) => {
      console.warn('Error during shutdown', e);
    });

    DocumentationService.reset();

    WSSService.close();
    server?.close();
    server = null;
  }

  function addProcessHandlers() {
    process.on('SIGTERM', async () => {
      await stop();
    });
    process.on('uncaughtException', async (reason) => {
      EventService.emit({ topic: 'SYS:::UNCAUGHT_EXCEPTION', data: { reason } });
      await stop(true);
    });
    process.on('unhandledRejection', async (reason) => {
      EventService.emit({ topic: 'SYS:::UNHANDLED_REJECTION', data: { reason } });
      await stop(true);
    });
  }

  export const state = ReactiveService.state;

  export function watch<T extends object, U = T>(
    reactive: ReactiveService.StateLike<T>,
    cfg: ReactiveConfig<T, U>
  ) {
    ensureInitialized();

    const origin = cfg.name
      ? `reactive:${cfg.name}`
      : `inline:reactive_${++inlineReactiveCounter}`;

    TopologyService.registerReactive(cfg, origin);

    return ReactiveService.watch(reactive, cfg, {
      emit: EventService.emit,
      kv: activeKv!,
      kvPath: createKVPath(activeKv!),
      logger: activeLogger!,
    });
  }
}
