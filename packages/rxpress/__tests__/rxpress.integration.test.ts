import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import { rxpress } from '../src/rxpress.js';
import type { Logger, KVBase, RPCConfig, EventConfig } from '../src/types/index.js';

const logger: Logger = {
  child: () => logger,
  info: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  log: () => undefined,
};

const store = new Map<string, unknown>();
const kv: KVBase = {
  set: (key, value) => {
    store.set(key, value);
  },
  get: <T = unknown>(key: string) => store.get(key) as T | undefined,
  has: (key) => store.has(key),
  del: (key) => {
    store.delete(key);
  },
};

const events: unknown[] = [];

const isPermissionError = (error: unknown) => {
  if (typeof error === 'string') {
    return error.includes('EPERM') || error.includes('EACCES');
  }
  if (error instanceof Error) {
    return /EPERM|EACCES/.test(error.message);
  }
  return false;
};

await rxpress.stop().catch(() => {});

await (async () => {
  rxpress.init({
    config: { port: 0, loadEnv: false },
    logger,
    kv,
  });

  const eventConfig: EventConfig = {
    subscribe: ['test::ping'],
    handler: async (input) => {
      events.push(input);
    },
  };
  rxpress.addEvents(eventConfig);

  const route: RPCConfig = {
    type: 'api',
    method: 'GET',
    path: '/ping',
    middleware: [],
    handler: async (_req, ctx) => {
      ctx.emit({ topic: 'test::ping', data: 'pong' });
      return { status: 200, body: { ok: true } };
    },
  };
  rxpress.addHandlers(route);

  let startResult: Awaited<ReturnType<typeof rxpress.start>> | null = null;
  try {
    startResult = await rxpress.start({ port: 0 });
  } catch (error) {
    if (isPermissionError(error)) {
      console.warn('[rxpress] integration test skipped due to listen permissions');
      return;
    }
    throw error;
  }

  const { server } = startResult;
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object', 'server did not bind to an address');
    const port = address.port;

    await delay(30);

    const response = await fetch(`http://127.0.0.1:${port}/ping`);
    if (response.status !== 200) {
      const body = await response.text();
      console.error(`[integration] unexpected status ${response.status}: ${body}`);
    }
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload, { ok: true });

    assert.deepEqual(events, ['pong']);
  } finally {
    await rxpress.stop();
  }
})();
