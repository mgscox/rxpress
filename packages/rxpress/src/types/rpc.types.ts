import * as z from 'zod';
import { ZodSchema } from 'zod';
import { NextFunction, Request, Response } from 'express';
import type { SendFileOptions } from 'express-serve-static-core';

import { KVBase } from './kv.types.js';
import { Logger } from './logger.types.js';
import { Emit } from './emit.types.js';
import { Context } from './metrics.types.js';

export type rxRequest = Request & {_rxpress: {trace: {initiated: number, start: number}}, user?: {id?: string}}
export type RPCTypes = 'http' | 'api' | 'cron' | 'sse';
export type RPCMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type RPCContext = { req: rxRequest; res: Response, ctx: Context };
export type RPCHttpResult = { status?: number; body: string; mime?: string };
export type RPCApiResult = { status?: number; body: object };
export type RPCResult = RPCHttpResult | RPCApiResult;
type MaybePromise<T> = T | Promise<T>;
export type SSESendOptions = {
  event?: string;
  id?: string;
  retry?: number;
};
export interface RPCSSEStream<T = unknown> {
  send: (payload: T, options?: SSESendOptions) => void;
  error: (payload: unknown, options?: SSESendOptions) => void;
}
export type HandlerContext = {
  emit: Emit;
  kv: KVBase;
  logger: Logger;
  stream?: RPCSSEStream;
};
export type RPCFunction = (
  req: Request,
  ctx: HandlerContext,
) => MaybePromise<RPCResult | void>;
export type RequestMiddleware = Request & {
  logger: Logger,
  kv: KVBase,
  emit: Emit,
}
export type RequestHandlerMiddleware = (req: RequestMiddleware, res: Response, next: NextFunction) => void | Promise<void>
export type RPCConfigCommon = {
  type: RPCTypes;
  name?: string;
  flow?: string;
  description?: string;
  method: RPCMethod;
  path: string;
  middleware?: RequestHandlerMiddleware[];
  emits?: string[];
  queryParams?: z.ZodArray<z.ZodString>;
  bodySchema?: ZodSchema;
  responseSchema?: z.ZodObject | Record<number, z.ZodObject>;
  strict?: boolean;
}
export type RPCConfigSatic = {
  staticRoute: {
    filename: string,
    options?: SendFileOptions,
  };
}
export type RPCConfigHanlder = {
  handler: RPCFunction;
}
export type RPCConfigBase = RPCConfigCommon & (RPCConfigSatic | RPCConfigHanlder);
export type RPCConfig = RPCConfigBase;
export type RPCRoutes = RPCConfig[];
export type EventContext = { trigger: string; logger: Logger; kv: KVBase, emit: Emit };
export type EventFunction = <T>(input: T, ctx: EventContext) => MaybePromise<void>;
export type EventConfig = {
  subscribe: string[];
  emits?: string[];
  handler: EventFunction;
};
export type Events = EventConfig[];
export type BufferLike =
    | string
    | Buffer
    | DataView
    | number
    | ArrayBufferView
    | Uint8Array
    | ArrayBuffer
    | SharedArrayBuffer
    | Blob
    | readonly any[]
    | readonly number[]
    | { valueOf(): ArrayBuffer }
    | { valueOf(): SharedArrayBuffer }
    | { valueOf(): Uint8Array }
    | { valueOf(): readonly number[] }
    | { valueOf(): string }
    | { [Symbol.toPrimitive](hint: string): string };