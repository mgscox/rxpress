import * as express from 'express';
import { globSync } from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

import { EventService } from './services/event.service';
import { RouteService } from './services/route.service';
import { Logger } from './types/logger.types';
import { KVBase } from './types/kv.types';
import { CronService } from './services/cron.service';
import { CronConfig, EventConfig, RPCConfig } from './types';

export namespace rxpress {
    var app: express.Express;
    var server: http.Server;
    export function createServer(port = 3000): Promise<http.Server> {
        app = express();
        app.use(express.json());
        server = http.createServer(app);
        return new Promise(resolve => {
            server.listen(port, () => {
                resolve(server)
            });
        })
    }
    async function registerEvent(file: string, logger: Logger, kv: KVBase) { 
        const module = await import( pathToFileURL(file).href );
        const config = module.config || module.default;
        if (config) {
            EventService.add(config, {logger, kv});
        }
        else {
            throw `(EVENT) Missing configuration export, ${file}`;
        }
    }
    async function registerHandler(file: string, logger: Logger, kv: KVBase) { 
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
    async function registerCron(file: string, logger: Logger, kv: KVBase) { 
        const module = await import( pathToFileURL(file).href );
        const config = module.config || module.default;
        if (config) {
            CronService.add(config, {logger, kv});
        }
        else {
            throw `(CRON) Missing configuration export, ${file}`;
        }
    }
    export async function loadEvents(eventDir: string, logger: Logger, kv: KVBase) {
        const eventFiles = globSync('./**/*.event.js', {cwd: eventDir});
        await Promise.all(eventFiles.map(async file => {
            return await registerEvent(file, logger, kv);
        }));
    }
    export function addEvents(events: EventConfig | EventConfig[], logger: Logger, kv: KVBase) {
        if (!Array.isArray(events)) {
            events = [events];
        }
        for (const event of events) {
            EventService.add(event, {logger, kv});
        }
    }
    export async function loadHanlders(handlerDir: string, logger: Logger, kv: KVBase) { 
        const handlerFiles = globSync('./**/*.handler.js', {cwd: handlerDir});
        await Promise.all(handlerFiles.map(async file => {
            return await registerHandler(file, logger, kv);
        }));
    }
    export function addHanlders(handlers: RPCConfig | RPCConfig[], logger: Logger, kv: KVBase) { 
        if (!Array.isArray(handlers)) {
            handlers = [handlers];
        }
        for (const handler of handlers) {
            RouteService.addHandler(handler, logger, kv);
        }
    }
    export async function loadCrons(cronDir: string, logger: Logger, kv: KVBase) {
        const cronFiles = globSync('./**/*.cron.js', {cwd: cronDir});
        await Promise.all(cronFiles.map(async file => {
            return await registerCron(file, logger, kv);
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
    export async function load(param:{ eventDir?: string; handlerDir?: string, cronDir?: string, logger: Logger, kv: KVBase}) {
        const {eventDir, handlerDir, cronDir, logger, kv} = param;
        if (eventDir) {
            await loadEvents(eventDir, logger, kv);
        }
        if (handlerDir) {
            await loadHanlders(handlerDir, logger, kv);
        }
        if (cronDir) {
            await loadCrons(cronDir, logger, kv);
        }
    }
    export async function start(param:{ eventDir?: string; handlerDir?: string, cronDir?: string, logger: Logger, kv: KVBase, port?: number}) {
        const {eventDir, handlerDir, cronDir, logger, kv, port} = param;
        await load({eventDir, handlerDir, cronDir, logger, kv});
        const server = await createServer(port);
        return server;
    }
    export function stop(): Promise<void> {
        EventService.close();
        RouteService.close();
        CronService.close();
        return new Promise(resolve => {
            server.close(() => resolve());
        })
    }
}