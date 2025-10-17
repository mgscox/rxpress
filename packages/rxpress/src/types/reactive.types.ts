import { OperatorFunction } from 'rxjs';
import type { Span } from '@opentelemetry/api';

import type { Emit } from './emit.types.js';
import type { KVBase, KVPath } from './kv.types.js';
import type { Logger } from './logger.types.js';
import type { RunContext } from './run.types.js';

export type Listener<T> = (next: T, prev: T) => void;
export const SUBSCRIBE = Symbol('rxpress.state.subscribe');
export const GET = Symbol('rxpress.state.get');
export const DESTROY = Symbol('rxpress.state.destroy');
export type Strategy = 'merge' | 'concat' | 'switch' | 'exhaust';

export type ReactiveHandlerContext = {
  emit: Emit;
  kv: KVBase;
  kvPath: KVPath;
  logger: Logger;
  run?: RunContext;
  span?: Span; // provided by the runtime for each emission
};

export type ReactiveEmission<T, U = T> = {
  next: U;
  prev?: U;
  root: T;
  ctx: ReactiveHandlerContext;
};

export type ReactiveHandler<T, U = T> = (
  next: U,
  prev: U | undefined,
  root: T,
  ctx: ReactiveHandlerContext,
) => Promise<void> | void;

type UserReactiveContext = Partial<Omit<ReactiveHandlerContext, 'span'>>;

export type ReactiveConfig<T, U = T> = {
  name?: string;
  description?: string;
  emits?: string[];
  select?: (root: T) => U; // default: identity
  filter?: (next: U, prev: U | undefined) => boolean; // default: any change
  pipes?: OperatorFunction<ReactiveEmission<T, U>, ReactiveEmission<T, U>>[]; // arbitrary RxJS ops
  strategy?: Strategy; // default: 'merge'
  handler: ReactiveHandler<T, U>;
  ctx?: UserReactiveContext | (() => UserReactiveContext);
};
