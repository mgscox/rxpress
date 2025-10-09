import * as z from 'zod';
import { ZodSchema } from 'zod';
import { Request, Response } from 'express';

import { KVBase } from './kv.types.js';
import { Logger } from './logger.types.js';
import { Emit } from './emit.types.js';
import { Context } from './metrics.types.js';

export type rxRequest = Request & {_rxpress: {trace: {initiated: number, start: number}}, user?: {id?: string}}
export type RPCTypes = 'http' | 'api' | 'cron';
export type RPCMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type RPCContext = { req: rxRequest; res: Response, ctx: Context };
export type RPCHttpResult = { status?: number; body: string; mime?: string };
export type RPCApiResult = { status?: number; body: object };
export type RPCResult = RPCHttpResult | RPCApiResult;
type MaybePromise<T> = T | Promise<T>;
export type RPCFunction = (
  req: Request,
  ctx: {
    emit: Emit;
    kv: KVBase;
    logger: Logger;
  },
) => MaybePromise<RPCResult>;
export type RPCConfigBase = {
  type: RPCTypes;
  name?: string;
  flow?: string;
  description?: string;
  method: RPCMethod;
  path: string;
  middleware?: any[];
  emits?: string[];
  queryParams?: z.ZodArray<z.ZodString>;
  bodySchema?: ZodSchema;
  responseSchema?: z.ZodObject | Record<number, z.ZodObject>;
  strict?: boolean;
  handler: RPCFunction;
};
export type RPCConfig = RPCConfigBase;
export type RPCRoutes = RPCConfig[];
export type EventContext = { trigger: string; logger: Logger; kv: KVBase };
export type EventFunction = <T>(input: T, ctx: EventContext) => MaybePromise<void>;
export type EventConfig = {
  subscribe: string[];
  emits?: string[];
  handler: EventFunction;
};
export type Events = EventConfig[];
