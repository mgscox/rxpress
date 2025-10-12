import express from 'express';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { globSync } from 'glob';

import {
  CronConfig,
  EventConfig,
  RPCConfig,
  RxpressConfig,
  Logger,
  KVBase,
  BufferLike,
} from './types/index.js';

import { EventService } from './services/event.service.js';
import { RouteService } from './services/route.service.js';
import { CronService } from './services/cron.service.js';
import { MetricService } from './services/metrics.service.js';
import { ConfigService } from './services/config.service.js';
import { WSSService } from './services/wss.service.js';
import { NextService } from './services/next.service.js';
import { DocumentationService } from './services/documentation.service.js';

export namespace rxpress {
  let app: express.Express | null = null;
  let server: http.Server | null = null;
  let activeLogger: Logger | null = null;
  let activeKv: KVBase | null = null;
  let activeConfig: RxpressConfig | null = null;
  let hostname = '0.0.0.0';
  let nextReady: Promise<void> | undefined;

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
    DocumentationService.attach(app);
    app.use(express.json(config.json));
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
            subscribe: ['wss.broadcast'],
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

  export function addEvents(events: EventConfig | EventConfig[]) {
    ensureInitialized();
    const entries = Array.isArray(events) ? events : [events];

    for (const event of entries) {
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

  export async function start(param: {
    eventDir?: string;
    handlerDir?: string;
    cronDir?: string;
    port?: number;
  }) {
    await load(param);

    if (activeConfig?.next) {
      nextReady = NextService.configure(app!, activeConfig.next, activeLogger!);
      await nextReady;
    }

    return await createServer(param.port);
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
