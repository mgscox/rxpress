import * as express from 'express';
import {Request, Response} from 'express';
import { Subject } from 'rxjs';
import * as z from 'zod';

import { RPCConfig, RPCContext, RPCHttpResult, RPCResult } from "../types/rpc.types";
import { EventService } from './event.service';
import { Logger } from '../types/logger.types';
import { KVBase } from '../types/kv.types';

export namespace RouteService {
    const pubs$: Record<string, Subject<RPCContext>> = {};

    const getPayload = (param:{error: string, reason: unknown, route: RPCConfig, req: Request}) => {
        const {error, reason, route, req} = param;
        if (reason instanceof Error) {
            try {
                reason.message = JSON.parse(reason.message);
            }
            catch { /* throw error away - message field wasnt JSON */ }
        }
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
    const handleError = (param:{payload: Record<string, unknown>, code?: number, route: RPCConfig, res: Response}): boolean => {
        const {payload, code, route, res} = param;
        console.warn(
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
    async function runHandler(param: {req: Request, res: Response, route: RPCConfig, logger: Logger, kv: KVBase}) {
        const {req, res, route, logger, kv} = param;
        let result!: RPCResult;
        if (!!route.bodySchema) {
            try {
                route.bodySchema.parse(req.body)
            }
            catch (reason) {
                const payload = getPayload({error: `Invalid request body payload`, reason: `${reason}`, route, req})
                if (handleError({payload, route, res})) {
                    return;
                }
            }
        }

        if (!!route.queryParams) {
            try {
                route.queryParams.parse(req.params)
            }
            catch (reason) {
                const payload = getPayload({error: `Invalid request parameters`, reason: `${reason}`, route, req})
                if (handleError({payload, route, res})) {
                    return;
                }
            }
        }

        try {
            result = await route.handler(req, {
                emit: EventService.emit, 
                kv, 
                logger,
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
                    const payload = getPayload({error: `Invalid API Response`, reason: `${reason}`, route, req});
                    if (handleError({payload, route, res})) {
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
            const payload = getPayload({error: `Invalid API response`, reason: `${reason}`, route, req})
            handleError({payload, code: 500, route, res});
        }
    }
    export function addHandler(route: RPCConfig, logger: Logger, kv: KVBase): express.Router {
        const router = express.Router(); 
        const signature = `${route.flow ? route.flow + '_' : ''}${route.method}::${route.path}`.toLowerCase()
        const pub$ = new Subject<RPCContext>()
        const method = route.method.toLowerCase() as keyof typeof router & 'get' | 'post' | 'put' | 'delete';
        pubs$[signature] = pub$
        router[method](route.path, ...route.middleware, (req: Request, res: Response) => {
            pubs$[signature]?.next({ req, res })
        });
        pubs$[signature].subscribe({
            next: ({req, res}) => runHandler({req, res, route, logger, kv})
        });
        return router;
    }
    export const close = () => {
        Object.values(pubs$).forEach(pub => pub.complete());
    }
}