import * as z from 'zod';
import { ZodSchema } from 'zod';
import { Request, Response} from 'express';

import { KVBase } from "./kv.types";
import { Logger } from "./logger.types";
import { Emit } from './emit.types';

export type RPCTypes = 'http' | 'api' | 'cron';
export type RPCMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type RPCContext = { req: Request; res: Response };
export type RPCHttpResult = {status?: number, body: string, mime?: string};
export type RPCApiResult = {status?: number, body: object};
export type RPCResult = RPCHttpResult | RPCApiResult;
export type RPCFunction = (
    req: Request, 
    ctx: {
        emit: Emit,
        kv: KVBase,
        logger: Logger
    }
) => Promise<RPCResult>
export type RPCConfigBase = {
    type: RPCTypes,
    name?: string;
    flow?: string;
    description?: string;
    method: RPCMethod,
    path: string,
    middleware: any[],
    emits?: string[],
    queryParams?: z.ZodArray<z.ZodString>;
    bodySchema?: ZodSchema,
    responseSchema?: z.ZodObject | Record<number, z.ZodObject>,
    strict?: boolean,
    handler: RPCFunction,
}
export type RPCConfig = RPCConfigBase;
export type RPCRoutes = RPCConfig[];
export type EventFunction = (input: unknown, ctx: {trigger: string, logger: Logger, kv: KVBase}) => Promise<void>;
export type EventConfig = {
    subscribe: string[],
    emits?: string[],
    handler: EventFunction,
}
export type Events = EventConfig[];