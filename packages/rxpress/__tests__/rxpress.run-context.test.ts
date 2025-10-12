import assert from 'node:assert/strict';

import { rxpress } from '../src/rxpress.js';
import type { Logger, KVBase, LogLogger, RPCConfig, EventConfig } from '../src/types/index.js';

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

await rxpress.stop().catch(() => {});

await (async () => {
  rxpress.init({
    config: { port: 0, loadEnv: false },
    logger,
    kv,
  });

  const eventRecords: Array<{ runId?: string; requestId?: string; sessionCounter?: unknown }> = [];
  const eventHandled = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('event not handled')), 2_000);
    const event: EventConfig = {
      subscribe: ['audit::run'],
      handler: async (_payload, ctx) => {
        const requestId = ctx.run ? await ctx.run.get<string>('request.id') : undefined;
        const sessionCounter = await ctx.kvPath.get('session.counter');
        eventRecords.push({ runId: ctx.run?.id, requestId, sessionCounter });
        clearTimeout(timeout);
        resolve();
      },
    };
    rxpress.addEvents(event);
  });

  const routes: RPCConfig[] = [
    {
      type: 'api',
      method: 'GET',
      path: '/run-id',
      emits: ['audit::run'],
      handler: async (_req, ctx) => {
        await ctx.run.set('request.id', ctx.run.id);
        const retrieved = await ctx.run.get('request.id');
        assert.equal(retrieved, ctx.run.id);
        await ctx.kvPath.set('session.counter', ctx.run.id);
        ctx.emit({ topic: 'audit::run' });
        return { status: 200, body: { runId: ctx.run.id } };
      },
    },
  ];

  rxpress.addHandlers(routes);

  const { server, port: requestedPort } = await rxpress.start({ port: 0 });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/run-id`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    const { runId } = payload as { runId: string };
    assert.ok(runId, 'run id missing from response');

    await eventHandled;

    assert.equal(eventRecords.length, 1);
    assert.equal(eventRecords[0]?.runId, runId);
    assert.equal(eventRecords[0]?.requestId, runId);
    assert.equal(eventRecords[0]?.sessionCounter, runId);

    const runKeys = Array.from(kvStore.keys()).filter((key) => key.startsWith('__run__:'));
    assert.equal(runKeys.length, 0, 'run-scoped kv entries not cleaned up');

    const session = kvStore.get('session') as Record<string, unknown> | undefined;
    assert.equal(session?.counter, runId);

    console.info('rxpress.run-context tests passed');
  }
  finally {
    await rxpress.stop();
    kvStore.clear();
  }
})();
