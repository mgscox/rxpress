import * as express from 'express';
import { globSync } from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

import { EventService } from './services/event.service';
import { Route } from './services/route.service';
import { Logger } from './types/logger.types';
import { KVBase } from './types/kv.types';

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
    async function registerEvent(file: string) { 
        const module = await import( pathToFileURL(file).href );
        const config = module.config || module.default;
        if (config) {
            EventService.add(config);
        }
        else {
            throw `Missing configuration export, ${file}`;
        }
    }
    async function registerHandler(file: string, logger: Logger, kv: KVBase) { 
        const module = await import( pathToFileURL(file).href );
        const route = module.config || module.default;
        const router = Route.addHandler(route, logger, kv);
        app.use(router);
    }
    export async function loadEvents(eventDir: string) {
        const eventFiles = globSync('./**/*.event.js', {cwd: eventDir});
        await Promise.all(eventFiles.map(async file => {
            return await registerEvent(file);
        }));
    }
    export async function loadHanlders(handlerDir: string, logger: Logger, kv: KVBase) { 
        const eventFiles = globSync('./**/*.handler.js', {cwd: handlerDir});
        await Promise.all(eventFiles.map(async file => {
            return await registerHandler(file, logger, kv);
        }));
    }
}