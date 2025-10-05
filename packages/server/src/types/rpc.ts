import * as z from 'zod';
import type {ZodSchema} from 'zod';
import type { Request, Response } from 'express';

export type Emit = (param: {topic: string, data?: unknown}) => void;
export type AppContext = Record<string, unknown>;
export type RPCTypes = 'http' | 'api' | 'cron';
export type RPCMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type RPCContext = { req: Request; res: Response };
export type RPCHttpResult = {status?: number, body: string, mime?: string};
export type RPCApiResult = {status?: number, body: object};
export type RPCResult = RPCHttpResult | RPCApiResult;
export type RPCFunction = (req: Request, ctx: {ctx: AppContext, emit: Emit}) => Promise<RPCResult>
export type RPCConfigBase = {
    type: RPCTypes,
    name?: string;
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
export type EventFunction = (input: unknown, ctx: {trigger: string}) => Promise<void>;
export type EventConfig = {
    subscribe: string[],
    emits?: string[],
    handler: EventFunction,
}
export type Events = EventConfig[];