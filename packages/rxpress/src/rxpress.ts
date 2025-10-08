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
} from './types/index.js';

import { EventService } from './services/event.service.js';
import { RouteService } from './services/route.service.js';
import { CronService } from './services/cron.service.js';
import { MetricService } from './services/metrics.service.js';
import { ConfigService } from './services/config.service.js';

export namespace rxpress {
  let app: express.Express | null = null;
  let server: http.Server | null = null;
  let activeLogger: Logger | null = null;
  let activeKv: KVBase | null = null;
  let activeConfig: RxpressConfig | null = null;
  let hostname = '0.0.0.0';

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

    if (config.metrics) {
      MetricService.start(config.metrics);
    }

    if (config.processHandlers) {
      addProcessHandlers();
    }

    app = express();
    app.use(express.json(config.json));
  }

  export function createServer(port = 3000): Promise<{ server: http.Server; port: number }> {
    ensureInitialized();
    const listenPort = activeConfig?.port ?? port;

    return new Promise((resolve, reject) => {
      server = http.createServer(app!);
      server.on('error', (error) => {
        reject(`${error}`);
      });
      server.on('listening', () => {
        resolve({ server: server!, port: listenPort });
      });
      server.listen(listenPort, hostname);
    });
  }

  async function registerEvent(file: string) {
    ensureInitialized();
    const module = await import(pathToFileURL(file).href);
    const config = module.config || module.default;

    if (config) {
      EventService.add(config, { logger: activeLogger!, kv: activeKv! });
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
      EventService.add(event, { logger: activeLogger!, kv: activeKv! });
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
    return await createServer(param.port);
  }

  export async function stop(critical = false): Promise<void> {
    if (!server) {
      return;
    }

    EventService.emit({ topic: 'SYS::SHUTDOWN', data: { critical } });
    EventService.close();
    RouteService.close();
    CronService.close();
    await Promise.all([
      MetricService.stop(),
      new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error);
          } 
          else {
            resolve();
          }
        });
      }),
    ]);
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
