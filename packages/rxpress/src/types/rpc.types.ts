import * as z from 'zod';
import { NextFunction, Request, Response } from 'express';
import type { SendFileOptions } from 'express-serve-static-core';
import type { ZodType, ZodTypeAny } from 'zod';
import type { Span } from '@opentelemetry/api';

import { KVBase, KVPath } from './kv.types.js';
import { Logger } from './logger.types.js';
import { Emit } from './emit.types.js';
import { Context } from './metrics.types.js';
import { RunContext } from './run.types.js';
import type { GrpcInvokeBinding } from './grpc.types.js';

export type rxRequest = Request & {_rxpress: {trace: {initiated: number, start: number}}, user?: {id?: string}}
export type RPCTypes = 'http' | 'api' | 'sse';
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
export type RPCStreamFormat = 'raw' | 'event';
export interface RPCSSEStream<T = unknown> {
  send: (payload: T, options?: SSESendOptions) => void;
  error: (payload: unknown, options?: SSESendOptions) => void;
}
type HandlerContextBase = {
  emit: Emit;
  kv: KVBase;
  kvPath: KVPath;
  logger: Logger;
  run: RunContext;
  stream?: RPCSSEStream;
  span?: Span;
};

export type HandlerContext<T extends RPCTypes = RPCTypes> = HandlerContextBase & (T extends 'sse'
  ? { stream: RPCSSEStream }
  : { stream?: RPCSSEStream });

export type RPCFunction<T extends RPCTypes = RPCTypes> = (
  req: Request,
  ctx: HandlerContext<T>,
) => MaybePromise<RPCResult | void>;
export type RequestMiddleware = Request & {
  logger: Logger,
  kv: KVBase,
  emit: Emit,
}
export type RequestHandlerMiddleware = (req: RequestMiddleware, res: Response, next: NextFunction) => void | Promise<void>
type RPCConfigCommon<T extends RPCTypes> = {
  type: T;
  name?: string;
  flow?: string;
  description?: string;
  method: RPCMethod;
  path: string;
  middleware?: RequestHandlerMiddleware[];
  emits?: string[];
  queryParams?: z.ZodArray<z.ZodString>;
  bodySchema?: ZodTypeAny;
  responseSchema?: ZodTypeAny | Record<number, ZodTypeAny>;
  strict?: boolean;
};

type RPCConfigStatic = {
  staticRoute: {
    filename: string,
    options?: SendFileOptions,
  };
  kind?: 'local';
};

type RPCHandlerConfig<T extends RPCTypes> = {
  kind?: 'local';
  handler: RPCFunction<T>;
};

type RPCGrpcHandlerConfig = {
  kind: 'grpc';
  grpc: GrpcInvokeBinding;
};

export type RPCConfigHttp = RPCConfigCommon<'http'> & (RPCConfigStatic | RPCHandlerConfig<'http'> | RPCGrpcHandlerConfig);
export type RPCConfigApi = RPCConfigCommon<'api'> & (RPCHandlerConfig<'api'> | RPCGrpcHandlerConfig);
export type RPCConfigSse = RPCConfigCommon<'sse'> & {
  streamFormat?: RPCStreamFormat;
} & RPCHandlerConfig<'sse'>;
export type RPCConfig = RPCConfigHttp | RPCConfigApi | RPCConfigSse;
export type RPCRoutes = RPCConfig[];
export type EventContext = {
  trigger: string;
  logger: Logger;
  kv: KVBase;
  kvPath: KVPath;
  emit: Emit;
  run?: RunContext;
};
export type EventFunction<T = unknown> = (input: T, ctx: EventContext) => MaybePromise<void>;
type EventConfigCommon<T> = {
  name?: string;
  description?: string;
  subscribe: string[];
  emits?: string[];
  schema?: ZodType<T>;
};

type EventConfigLocal<T> =
  | (EventConfigCommon<T> & { kind?: 'local'; strict?: false; handler: EventFunction<T> })
  | (EventConfigCommon<T> & { kind?: 'local'; strict: true; schema: ZodType<T>; handler: EventFunction<T> });

type EventConfigGrpc<T> =
  | (EventConfigCommon<T> & { kind: 'grpc'; strict?: false; grpc: GrpcInvokeBinding })
  | (EventConfigCommon<T> & { kind: 'grpc'; strict: true; schema: ZodType<T>; grpc: GrpcInvokeBinding });

export type EventConfig<T = unknown> = EventConfigLocal<T> | EventConfigGrpc<T>;
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
