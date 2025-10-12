import express, { type Application, type RequestHandler } from 'express';
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
} from './types/index.js';

import { EventService } from './services/event.service.js';
import { RouteService } from './services/route.service.js';
import { CronService } from './services/cron.service.js';
import { MetricService } from './services/metrics.service.js';
import { ConfigService } from './services/config.service.js';
import { WSSService } from './services/wss.service.js';
import { NextService } from './services/next.service.js';
import { DocumentationService } from './services/documentation.service.js';

type UseParams = Parameters<Application['use']>;
const createHelmetMiddleware = helmet as unknown as (options?: HelmetOptions) => RequestHandler;

export namespace rxpress {
  let app: express.Express | null = null;
  let server: http.Server | null = null;
  let activeLogger: Logger | null = null;
  let activeKv: KVBase | null = null;
  let activeConfig: RxpressConfig | null = null;
  let hostname = '0.0.0.0';
  let nextReady: Promise<void> | undefined;
  const emitTopics = new Map<string, Set<string>>();
  const handlerTopics = new Map<string, Set<string>>();

  const ensureInitialized = () => {
    if (!app || !activeLogger || !activeKv || !activeConfig) {
      throw new Error('rxpress.init() must be called before invoking this function.');
    }
  };

  const registerEmit = (topic: string, source: string) => {
    const entry = emitTopics.get(topic) ?? new Set<string>();
    entry.add(source);
    emitTopics.set(topic, entry);
  };

  const registerSubscription = (topic: string, source: string) => {
    const entry = handlerTopics.get(topic) ?? new Set<string>();
    entry.add(source);
    handlerTopics.set(topic, entry);
  };

  const trackRoute = (route: RPCConfig, origin: string) => {
    if (route.emits) {
      for (const topic of route.emits) {
        registerEmit(topic, origin);
      }
    }
  };

  const trackEvent = <T>(event: EventConfig<T>, origin: string) => {
    for (const topic of event.subscribe) {
      registerSubscription(topic, origin);
    }

    if (event.emits) {
      for (const topic of event.emits) {
        registerEmit(topic, `${origin}::emit`);
      }
    }
  };

  const trackCron = (cron: CronConfig, origin: string) => {
    if (cron.emits) {
      for (const topic of cron.emits) {
        registerEmit(topic, origin);
      }
    }
  };

  const resetTracking = () => {
    emitTopics.clear();
    handlerTopics.clear();
  };

  export function init(param: { config: RxpressConfig; logger: Logger; kv: KVBase }): void {
    const { config, logger, kv } = param;

    activeConfig = config;
    activeLogger = logger;
    activeKv = kv;
    hostname = config.hostname || hostname;
    resetTracking();

    if (config.rootDir) {
      ConfigService.setRootDir(config.rootDir);
    }

    if (config.loadEnv !== false) {
      ConfigService.loadEnv(config.envFiles);
    }

    DocumentationService.configure(config.documentation);

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
  }

  export function use(...args: UseParams): void {
    ensureInitialized();
    app!.use(...args);
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
          EventService.add({
            subscribe: ['SYS::WSS::BROADCAST'],
            handler: async (input: unknown) => {
              const payload = (input === typeof 'BufferLike')
                ? <BufferLike>input
                : JSON.stringify(input);
              WSSService.broadcast(payload);
            },
          }, {
            logger: activeLogger!,
            kv: activeKv!,
            emit: EventService.emit,
          });
          registerSubscription('SYS::WSS::BROADCAST', 'internal:wss-broadcast');
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
      trackEvent(config, `event:${file}`);
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
      trackRoute(route, `route:${label}`);
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
        trackCron(cron, `cron:${label}`);
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
      trackEvent(event, 'inline-event');
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
      trackRoute(handler, `inline-route:${label}`);
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

    for (const cron of entries) {
      const label = cron.handler.name ?? 'inline-cron';
      trackCron(cron, `inline-cron:${label}`);
      CronService.add(cron, { logger: activeLogger!, kv: activeKv! });
    }
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
      const missingHandlers: Array<{ topic: string; sources: string[] }> = [];
      const unusedHandlers: Array<{ topic: string; sources: string[] }> = [];

      for (const [topic, sources] of emitTopics.entries()) {
        if (topic.startsWith('SYS::')) {
          continue;
        }

        if (!handlerTopics.has(topic)) {
          missingHandlers.push({ topic, sources: [...sources] });
        }
      }

      for (const [topic, sources] of handlerTopics.entries()) {
        if (topic.startsWith('SYS::')) {
          continue;
        }

        if (!emitTopics.has(topic)) {
          unusedHandlers.push({ topic, sources: [...sources] });
        }
      }

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
}
