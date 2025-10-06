import * as http from 'node:http'
import { Subject } from 'rxjs';
import * as z from 'zod';
import { globSync } from 'glob'
import { dirname, join } from 'node:path';
import express from 'express';
import { v4 } from 'uuid';

import type { RPCRoutes, Events, RPCContext, AppContext, RPCResult, RPCHttpResult } from './types/index.js';
import type { Request, Response } from 'express';

import { EventService } from './services/event.service.js';
import { globalLogger, Logger } from './services/logger.service.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createKv } from './services/kv.service.js';

const app = express();
const server = http.createServer(app)
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const routes: RPCRoutes = [{
    method: 'GET',
    path: '/',
    middleware: [],
    type: 'api',
    emits: ['do-log'],
    responseSchema: {
        200: z.object({wibble: z.string()}),
    },
    strict: false,
    handler: async function(req, {ctx, emit}) { 
        emit({
            topic: 'do-log',
            data: `Hello from ${req.path}`
        })
        return {body: {result: 'Hello World!'}};
    }
}];
const events: Events = [{
    subscribe: ['do-log'],
    handler: async function(input, {trigger}) { 
        globalLogger.log({level: 'info', msg: input, trigger}); 
    }
}, {
    subscribe: ['app::warning'],
    handler: async function(input, {trigger}) { 
        input = `string` === typeof input ? input : JSON.stringify(input, null, 2)
        globalLogger.warn('warning', {input, trigger}); 
    }
}];

async function registerEvent(file: string) { 
    const module = await import( pathToFileURL(file).href )
    EventService.add(module.default);
}

async function main() { 
    EventService.add(events);
    const eventFiles = globSync('*.js', {absolute: true, cwd: join(__dirname, 'events')});
    globalLogger.debug(`Adding event files`, eventFiles)
    await Promise.all(eventFiles.map(async file => {
        return await registerEvent(file);
    }));
    const expectedEmitHandlers: string[] = [];
    const router = express.Router();
    const pubs$: Record<string, Subject<RPCContext>> = {};

    const ctx: AppContext = {};

    for (const entry of [...routes, ...events]) {
        if (entry.emits) {
            for (const topic of entry.emits) {
                if (!expectedEmitHandlers.includes(topic)) {
                    expectedEmitHandlers.push(topic);
                }
            }
        }
    }
    const httpRoutes = routes.filter(r => ['http', 'api'].includes(r.type));
    for(const route of httpRoutes) {
        const signature = `${route.method}::${route.path}`.toLowerCase()
        const pub$ = new Subject<RPCContext>()
        const method = route.method.toLowerCase();
        pubs$[signature] = pub$
        //@ts-expect-error
        router[method](route.path, ...route.middleware, (req: Request, res: Response) => {
            pubs$[signature]?.next({ req, res })
        });
        pubs$[signature].subscribe({
            next: async ({ req, res }) => {
                const getPayload = (param:{error: string, reason: string}) => {
                    const {error, reason} = param;
                    return {
                        error,
                        reason,
                        route: {
                            ...route,
                            bodySchema: route.bodySchema ? z.toJSONSchema( route.bodySchema as any ) : undefined,
                            queryParams: route.queryParams ? z.toJSONSchema( route.queryParams as any ) : undefined,
                            responseSchema: route.responseSchema 
                                ? (route.responseSchema instanceof z.ZodObject)
                                    ? z.toJSONSchema( route.responseSchema ) 
                                    : Object.entries( route.responseSchema as Record<number, z.ZodObject<any>> )
                                        .map(([code, schema]) => ({statusCode: code,  schema: z.toJSONSchema(schema)}))
                                : undefined,
                        },
                        req: {
                            headers: req.headers,
                            body: req.body,
                        }
                    }
                }
                const handleError = (payload: Record<string, unknown>, code?: number): boolean => {
                    globalLogger.warn(
                        'Server route error',
                        payload,
                    )
                    if (route.strict || code === 500) {
                        res.status(code || 422);
                        if (route.type === 'api') {
                            res.json(payload);
                        }
                        else {
                            res.send(payload);
                        }
                        return true;
                    }
                    return false;
                }

                let result!: RPCResult;
                const kv = createKv(v4(), false);

                if (!!route.bodySchema) {
                    try {
                        route.bodySchema.parse(req.body)
                    }
                    catch (reason) {
                        const payload = getPayload({error: `Invalid request body payload`, reason: `${reason}`})
                        if (handleError(payload)) {
                            return;
                        }
                    }
                }

                if (!!route.queryParams) {
                    try {
                        route.queryParams.parse(req.params)
                    }
                    catch (reason) {
                        const payload = getPayload({error: `Invalid request parameters`, reason: `${reason}`});
                        if (handleError(payload)) {
                            return;
                        }
                    }
                }

                try {
                    result = await route.handler(req, {
                        ctx, 
                        emit: EventService.emit, 
                        kv, 
                        logger: new Logger
                    })
                }
                catch (reason) {
                    result = {
                        status: 500,
                        body: {
                            error: `${reason}`
                        }
                    }
                }
                finally {
                    if (!!route.responseSchema) {
                        const toParse = (route.responseSchema instanceof z.ZodObject)
                            ? route.responseSchema
                            : route.responseSchema[result.status || 200] || z.object({error: z.string()});

                        try {
                            toParse.parse(result.body);
                        }
                        catch (reason) {
                            const payload = getPayload({error: `Invalid API response`, reason: `${reason}`})
                            if (handleError(payload)) {
                                return;
                            }
                        }
                    }
                }

                try {
                    switch (route.type) {
                        case 'http': {
                            const httpResult = result as RPCHttpResult;
                            res.contentType(httpResult.mime || 'text/html')
                            res.status(result.status || 200).send(`${result.body}`);
                            break;
                        }
                        case 'api': {
                            res.contentType('application/json')
                            res.status(result.status || 200).json(result.body);
                            break;
                        }
                    }
                }
                catch (reason) {
                    console.error(reason);
                    const payload = getPayload({error: `Invalid API response`, reason: `${reason}`})
                    handleError(payload, 500);
                }
            },
            error(err) {
                console.error(err)
            },
        });
        globalLogger.info(`Added route ${signature}`)
    };

    for (const trigger of expectedEmitHandlers) {
        if (!EventService.has(trigger)) {
            console.warn(`Missing event handler for ${trigger}`)
        }
    }
    app.use(router)

    server.on('error', (error) => {
        console.error('Server error:', error)
    });
    server.on('close', () => {
        Object.keys(pubs$).forEach(key => pubs$[key]?.complete());
        EventService.close();
        console.info('Server closed')
    });
    const PORT = parseInt(process.env.PORT || '3002', 10);
    server.listen(PORT, () => {
        globalLogger.info(`Server is running on port ${PORT}`);
    });
}
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
main()
    .catch(err => {
        console.error('Fatal error starting server:', err);
        process.exit(1);
    });
