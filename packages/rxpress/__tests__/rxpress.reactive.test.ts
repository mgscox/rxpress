import assert from 'node:assert/strict';
import { tap } from 'rxjs/operators';
import { filter as rxFilter } from 'rxjs/operators';

import { rxpress } from '../src/rxpress.js';
import type {
  EventConfig,
  KVBase,
  Logger,
  LogLogger,
  ReactiveConfig,
} from '../src/types/index.js';

const logger: Logger = {
  child: () => logger,
  info: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  log: () => undefined,
  addListener: (_cb: LogLogger) => undefined,
};

const kvStore = new Map<string, unknown>();
const kv: KVBase = {
  get: <T = unknown>(key: string) => kvStore.get(key) as T | undefined,
  set: (key, value) => {
    kvStore.set(key, value);
  },
  has: (key) => kvStore.has(key),
  del: (key) => {
    kvStore.delete(key);
  },
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await rxpress.stop().catch(() => {});

// Test 1: reactive handler receives run/span context and emits events with correlation data.
await (async () => {
  rxpress.init({
    config: { port: 0, loadEnv: false },
    logger,
    kv,
  });

  const eventRecords: Array<{ runId?: string }> = [];
  const eventHandled = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('reactive event not handled')), 2_000);
    const event: EventConfig = {
      subscribe: ['reactive::changed'],
      handler: async (_payload, ctx) => {
        eventRecords.push({ runId: ctx.run?.id });
        clearTimeout(timeout);
        resolve();
      },
    };

    rxpress.addEvents(event);
  });

  const state = rxpress.state({ count: 0 });

  const handlerCalls: Array<{ next: number; prev?: number; runId?: string; spanTraceId?: string }> = [];
  const subscription = rxpress.watch(state, {
    select: (root) => root.count,
    handler: async (next, prev, root, ctx) => {
      handlerCalls.push({
        next,
        prev,
        runId: ctx.run?.id,
        spanTraceId: ctx.span?.spanContext().traceId,
      });

      ctx.emit({ topic: 'reactive::changed', data: { count: next } });
      assert.equal(root.count, next);
    },
  } satisfies ReactiveConfig<{ count: number }, number>);

  state.count = 1;

  await eventHandled;

  subscription.unsubscribe();

  await sleep(0);

  assert.equal(handlerCalls.length, 1);
  assert.equal(handlerCalls[0]?.next, 1);
  assert.ok(handlerCalls[0]?.runId, 'run id missing from handler context');
  assert.equal(typeof handlerCalls[0]?.spanTraceId, 'string');
  assert.equal(eventRecords.length, 1);
  assert.equal(eventRecords[0]?.runId, handlerCalls[0]?.runId);
  const runKeys = Array.from(kvStore.keys()).filter((key) => key.startsWith('__run__:'));
  assert.equal(runKeys.length, 0, 'run context not released');

  await rxpress.stop();
  console.info('rxpress reactive context tests passed');
})();

// Test 2: reactive pipes gate handler execution.
await (async () => {
  rxpress.init({
    config: { port: 0, loadEnv: false },
    logger,
    kv,
  });

  const state = rxpress.state({ count: 0 });

  const tapped: number[] = [];
  const handled: number[] = [];

  const subscription = rxpress.watch(state, {
    select: (root) => root.count,
    pipes: [
      tap(({ next }) => {
        tapped.push(next);
      }),
      rxFilter(({ next }) => next > 1),
    ],
    handler: async (next) => {
      handled.push(next);
    },
  } satisfies ReactiveConfig<{ count: number }, number>);

  state.count = 1;
  await sleep(0);
  state.count = 2;

  await sleep(10);

  subscription.unsubscribe();

  assert.deepEqual(tapped, [1, 2]);
  assert.deepEqual(handled, [2]);

  await rxpress.stop();
  console.info('rxpress reactive pipes tests passed');
})();

// Test 3: provided run context is respected and not released automatically.
await (async () => {
  rxpress.init({
    config: { port: 0, loadEnv: false },
    logger,
    kv,
  });

  const { createRun: createRunScope, releaseRun: releaseRunScope } = await import('../src/services/run.service.js');
  const providedRun = await createRunScope(kv);
  const state = rxpress.state({ count: 0 });

  const observedRuns: Array<string | undefined> = [];
  const subscription = rxpress.watch(state, {
    select: (root) => root.count,
    ctx: () => ({ run: providedRun }),
    handler: async (_next, _prev, _root, ctx) => {
      observedRuns.push(ctx.run?.id);
    },
  } satisfies ReactiveConfig<{ count: number }, number>);

  state.count = 1;
  await sleep(10);

  subscription.unsubscribe();

  assert.deepEqual(observedRuns, [providedRun.id]);

  await releaseRunScope(providedRun.id);

  const runKeys = Array.from(kvStore.keys()).filter((key) => key.startsWith('__run__:'));
  assert.equal(runKeys.length, 0, 'provided run should be releasable by caller');

  await rxpress.stop();
  console.info('rxpress reactive provided run tests passed');
})();

kvStore.clear();
