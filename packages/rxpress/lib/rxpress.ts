import * as express from 'express';
import { globSync } from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

import { EventService } from './services/event.service';
import { RouteService } from './services/route.service';
import { Logger } from './types/logger.types';
import { KVBase } from './types/kv.types';
import { CronService } from './services/cron.service';
import { CronConfig, EventConfig, RPCConfig, RxpressConfig } from './types';

export namespace rxpress {
    var app: express.Express;
    var server: http.Server;
    var logger: Logger;
    var kv: KVBase;
    var config: RxpressConfig;
    export function init(param: {config: RxpressConfig, logger: Logger, kv: KVBase}) {
        if (config.processHandlers) {
            addProcessHandlers();
        }
        config = param.config;
        logger = param.logger;
        kv = param.kv;
    }
    export function createServer(port = 3000): Promise<{server: http.Server, port: number}> {
        app = express();
        app.use(express.json(config.json));
        server = http.createServer(app);
        return new Promise((resolve, reject) => {
            const listenPort = config.port || port;
            server.on('error', (e) => {
                reject(`${e}`)
            });
            server.listen(listenPort, () => {
                resolve({server, port: listenPort})
            });
        })
    }
    async function registerEvent(file: string) { 
        const module = await import( pathToFileURL(file).href );
        const config = module.config || module.default;
        if (config) {
            EventService.add(config, {logger, kv});
        }
        else {
            throw `(EVENT) Missing configuration export, ${file}`;
        }
    }
    async function registerHandler(file: string) { 
        const module = await import( pathToFileURL(file).href );
        const route = module.config || module.default;
        if (route) {
            const router = RouteService.addHandler(route, logger, kv);
            app.use(router);
        }
        else {
            throw `(HANDLER) Missing configuration export, ${file}`;
        }
    }
    async function registerCron(file: string) { 
        const module = await import( pathToFileURL(file).href );
        const config = module.config || module.default;
        if (config) {
            CronService.add(config, {logger, kv});
        }
        else {
            throw `(CRON) Missing configuration export, ${file}`;
        }
    }
    export async function loadEvents(eventDir: string) {
        const eventFiles = globSync('./**/*.event.js', {cwd: eventDir});
        await Promise.all(eventFiles.map(async file => {
            return await registerEvent(file);
        }));
    }
    export function addEvents(events: EventConfig | EventConfig[]) {
        if (!Array.isArray(events)) {
            events = [events];
        }
        for (const event of events) {
            EventService.add(event, {logger, kv});
        }
    }
    export async function loadHanlders(handlerDir: string) { 
        const handlerFiles = globSync('./**/*.handler.js', {cwd: handlerDir});
        await Promise.all(handlerFiles.map(async file => {
            return await registerHandler(file);
        }));
    }
    export function addHanlders(handlers: RPCConfig | RPCConfig[]) { 
        if (!Array.isArray(handlers)) {
            handlers = [handlers];
        }
        for (const handler of handlers) {
            RouteService.addHandler(handler, logger, kv);
        }
    }
    export async function loadCrons(cronDir: string) {
        const cronFiles = globSync('./**/*.cron.js', {cwd: cronDir});
        await Promise.all(cronFiles.map(async file => {
            return await registerCron(file);
        }));
    }
    export function addCrons(crons: CronConfig | CronConfig[], logger: Logger, kv: KVBase) {
        if (!Array.isArray(crons)) {
            crons = [crons];
        }
        for (const cron of crons) {
            CronService.add(cron, {logger, kv});
        }
    }
    export async function load(param:{ eventDir?: string; handlerDir?: string, cronDir?: string}) {
        const {eventDir, handlerDir, cronDir} = param;
        if (eventDir) {
            await loadEvents(eventDir);
        }
        if (handlerDir) {
            await loadHanlders(handlerDir);
        }
        if (cronDir) {
            await loadCrons(cronDir);
        }
    }
    export async function start(param:{ eventDir?: string; handlerDir?: string, cronDir?: string, port?: number}) {
        const {eventDir, handlerDir, cronDir, port} = param;
        await load({eventDir, handlerDir, cronDir});
        const server = await createServer(port);
        return server;
    }
    export function stop(): Promise<void> {
        EventService.emit({topic: 'SYS::SHUTDOWN', data: {}});
        EventService.close();
        RouteService.close();
        CronService.close();
        return new Promise(resolve => {
            server.close(() => resolve());
        })
    }
    function addProcessHandlers() {
        process.on('SIGTERM', async () => {
            await stop();
        });
        process.on('uncaughtException', async (reason) => {
            EventService.emit({topic: 'SYS:::UNCAUGHT_EXCEPTION', data: {reason}});
            await stop();
        });
        process.on('unhandledRejection', async (reason) => {
            EventService.emit({topic: 'SYS:::UNCAUGHT_EXCEPTION', data: {reason}});
            await stop();
        });
    }
}