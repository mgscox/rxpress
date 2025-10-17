import {
  Observable,
  from,
  mergeMap,
  concatMap,
  switchMap,
  exhaustMap,
  map,
  pairwise,
  startWith,
  filter as rxFilter,
} from 'rxjs';
import { SpanStatusCode } from '@opentelemetry/api';

import {
  DESTROY,
  GET,
  Listener,
  SUBSCRIBE,
  ReactiveConfig,
  ReactiveEmission,
  ReactiveHandlerContext,
} from '../types/reactive.types.js';
import { createKVPath } from './kv-path.service.js';
import { MetricService } from './metrics.service.js';
import { createRun as createRunScope, releaseRun as releaseRunScope } from './run.service.js';

export namespace ReactiveService {
  /*
    Ergonomics: mutate with plain property sets: val.count++, val.a.b.c = 42.
    RxJS everywhere: watch() builds an Observable of changes, so your pipes slot can use any operators (e.g., throttleTime, bufferTime, auditTime, custom operators).
    Concurrency control: choose how async handlers overlap via strategy:
      - switch (cancel previous), concat (queue), exhaust (drop while running), merge (default, run in parallel).
    Batching: proxy emits at most once per microtask even if many fields change.
  */

  // ---------- minimal proxy state (deep reactive) ----------
  export type StateLike<T> = T & {
    [SUBSCRIBE]: (fn: Listener<T>) => () => void;
    [GET]: () => T;
    [DESTROY]: () => void;
  };

  export function state<T extends object>(initial: T): StateLike<T> {
    let root: any = initial;
    const listeners = new Set<Listener<T>>();
    let scheduled = false;
    let snapshot = clone(initial);

    const wrap = (obj: any): any =>
      isObj(obj)
        ? new Proxy(obj, {
          get(target, prop, recv) {
            if (prop === SUBSCRIBE || prop === GET || prop === DESTROY) {
              return Reflect.get(target, prop, recv);
            }

            const v = Reflect.get(target, prop, recv);
            return isObj(v) ? wrap(v) : v;
          },
          set(target, prop, value, recv) {
            const old = Reflect.get(target, prop, recv);
            const nextVal = isObj(value) ? wrap(value) : value;
            const ok = Reflect.set(target, prop, nextVal, recv);

            if (!Object.is(old, nextVal) && ok) {
              schedule();
            }

            return ok;
          },
          deleteProperty(target, prop) {
            const existed = Object.prototype.hasOwnProperty.call(target, prop);
            const ok = Reflect.deleteProperty(target, prop);

            if (existed && ok) {
              schedule();
            }

            return ok;
          },
          defineProperty(target, prop, desc) {
            const ok = Reflect.defineProperty(target, prop, desc);
            schedule();
            return ok;
          },
        })
        : obj;

    function schedule() {
      if (scheduled) {
        return;
      }

      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        const prev = snapshot as T;
        const curr = root as T;
        snapshot = clone(curr);

        for (const fn of listeners) {
          fn(curr, prev);
        }
      });
    }

    const proxy = wrap(initial) as StateLike<T>;
    Object.defineProperties(proxy, {
      [SUBSCRIBE]: { value: (fn: Listener<T>) => (listeners.add(fn), () => listeners.delete(fn)), enumerable: false },
      [GET]: { value: () => root as T, enumerable: false },
      [DESTROY]: { value: () => listeners.clear(), enumerable: false },
    });

    root = proxy;
    return proxy;
  }

  function isObj(x: unknown) {
    return x && typeof x === 'object';
  }

  function clone<T>(v: T): T {
    if (typeof (globalThis as any).structuredClone === 'function') {
      try {
        return (globalThis as any).structuredClone(v);
      }
      catch {
        // fall through to JSON clone below
      }
    }

    return JSON.parse(JSON.stringify(v));
  }

  // ---------- watch() API (rxjs-powered) ----------
  export function watch<T extends object, U = T>(
    reactive: StateLike<T>,
    cfg: ReactiveConfig<T, U>,
    ctx: ReactiveHandlerContext,
  ) {
    const {
      select = (x => x as unknown as U),
      filter: userFilter = (n, p) => p === undefined || !shallowEqual(n, p),
      pipes = [],
      strategy = 'merge',
      handler,
    } = cfg;

    const baseContext: ReactiveHandlerContext = {
      ...ctx,
      kvPath: ctx.kvPath ?? createKVPath(ctx.kv),
    };

    const resolveUserContext = () => {
      if (typeof cfg.ctx === 'function') {
        return cfg.ctx() ?? {};
      }

      return cfg.ctx ?? {};
    };

    const buildContext = (): ReactiveHandlerContext => {
      const userCtx = resolveUserContext();
      const merged: ReactiveHandlerContext = {
        ...baseContext,
        ...userCtx,
      };

      if (userCtx.kvPath === undefined) {
        merged.kvPath = baseContext.kvPath;
      }

      if (userCtx.emit === undefined) {
        merged.emit = (param) => {
          const inferredRun = merged.run ?? param.run;
          const inferredTrace = merged.span ? merged.span.spanContext() : param.traceContext;
          baseContext.emit({ ...param, run: inferredRun, traceContext: inferredTrace });
        };
      }

      return merged;
    };

    const base$ = new Observable<{ root: T; sel: U }>((sub) => {
      const unsub = reactive[SUBSCRIBE]((curr) => sub.next({ root: curr, sel: select(curr) }));
      return () => unsub();
    }).pipe(
      startWith({ root: reactive[GET](), sel: select(reactive[GET]()) }),
      pairwise(),
      rxFilter(([prev, curr]) => userFilter(curr.sel, prev?.sel)),
      map(([prev, curr]) => ({
        next: curr.sel,
        prev: prev?.sel,
        root: curr.root,
        ctx: buildContext(),
      })),
    ) as Observable<ReactiveEmission<T, U>>;

    const source$ = pipes.length
      ? pipes.reduce<Observable<ReactiveEmission<T, U>>>((stream, operator) => stream.pipe(operator), base$)
      : base$;

    const tracer = MetricService.getTracer();
    const toPromise = (payload: ReactiveEmission<T, U>) =>
      from(new Promise<void>((resolve, reject) => {
        const activeContext = MetricService.getContext().active();

        MetricService.getContext().with(activeContext, () => {
          const spanName = cfg.name ? `reactive ${cfg.name}` : 'rxpress.reactive';
          tracer.startActiveSpan(spanName, async (span) => {
            payload.ctx.span = span;
            span.setAttributes({
              'rxpress.reactive.has_prev': Number(payload.prev !== undefined),
            });

            let createdRun: ReactiveHandlerContext['run'] | undefined;

            try {
              if (!payload.ctx.run) {
                createdRun = await createRunScope(baseContext.kv);
                payload.ctx.run = createdRun;
              }

              await handler(payload.next, payload.prev, payload.root, payload.ctx);
              span.setStatus({ code: SpanStatusCode.OK });
              resolve();
            }
            catch (error) {
              span.recordException(error as Error);
              span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
              reject(error);
            }
            finally {
              try {
                if (createdRun) {
                  await releaseRunScope(createdRun.id);
                  payload.ctx.run = undefined;
                }
              }
              catch (releaseError) {
                baseContext.logger.error('reactive run release failed', { error: `${releaseError}` });
              }

              span.end();
            }
          });
        });
      }));

    const stratOp = strategy === 'switch'
      ? switchMap(toPromise)
      : strategy === 'concat'
        ? concatMap(toPromise)
        : strategy === 'exhaust'
          ? exhaustMap(toPromise)
          : mergeMap(toPromise);

    const sub = source$.pipe(stratOp).subscribe({
      error: (error) => {
        try {
          baseContext.logger.error('watch error', { error });
        }
        catch (loggingError) {
          console.error('watch error (logging failed)', { error, loggingError });
        }
      },
    });

    return { unsubscribe: () => sub.unsubscribe() };
  }

  // shallow-ish default equality for select() values
  function shallowEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) {
      return true;
    }

    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
      return false;
    }

    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);

    if (ak.length !== bk.length) {
      return false;
    }

    for (const k of ak) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) {
        return false;
      }

      if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
        return false;
      }
    }

    return true;
  }
}
