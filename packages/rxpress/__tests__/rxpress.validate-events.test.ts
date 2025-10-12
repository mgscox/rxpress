import assert from 'node:assert/strict';

import { rxpress } from '../src/rxpress.js';
import type { EventConfig, Logger, KVBase, LogLogger, RPCConfig } from '../src/types/index.js';

const logger: Logger = {
  child: () => logger,
  info: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  log: () => undefined,
  addListener: function (_callback: LogLogger): void {
    throw new Error('Function not implemented.');
  },
};

const kvStore = new Map<string, unknown>();
const kv: KVBase = {
  set: (key, value) => {
    kvStore.set(key, value);
  },
  get: <T = unknown>(key: string) => kvStore.get(key) as T | undefined,
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

  const orphanEvent: EventConfig = {
    subscribe: ['validate::missing'],
    handler: async () => undefined,
  };

  const emittingRoute: RPCConfig = {
    type: 'api',
    method: 'GET',
    path: '/validate',
    emits: ['validate::emits'],
    handler: async (_req, ctx) => {
      ctx.emit({ topic: 'validate::emits', data: 'payload' });
      return { status: 200, body: { ok: true } };
    },
  };

  rxpress.addEvents(orphanEvent);
  rxpress.addHandlers(emittingRoute);

  const { server } = await rxpress.start({ port: 0, validateEvents: false });

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    assert.equal(address.port > 0, true);
    console.info('rxpress.validate-events disabled test passed');
  }
  finally {
    await rxpress.stop();
    kvStore.clear();
  }
})();
