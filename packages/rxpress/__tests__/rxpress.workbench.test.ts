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
    config: {
      port: 0,
      loadEnv: false,
      workbench: { path: '/topology.dot' },
    },
    logger,
    kv,
  });

  const route: RPCConfig = {
    type: 'api',
    method: 'GET',
    path: '/status',
    emits: ['app::health'],
    handler: async (_req, ctx) => {
      ctx.emit({ topic: 'app::health', data: { ok: true } });
      return { status: 200, body: { ok: true } };
    },
  };

  const event: EventConfig = {
    subscribe: ['app::health'],
    handler: async () => undefined,
  };

  rxpress.addHandlers(route);
  rxpress.addEvents(event);

  const { server } = await rxpress.start({ port: 0 });

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const port = address.port;

    const response = await fetch(`http://127.0.0.1:${port}/topology.dot`);
    assert.equal(response.status, 200);
    const dot = await response.text();
    assert.ok(dot.includes('digraph'), 'DOT output missing digraph header');
    assert.ok(dot.includes('app::health'), 'DOT output missing topic node');
    console.info('rxpress.workbench topology endpoint passed');
  }
  finally {
    await rxpress.stop();
    kvStore.clear();
  }
})();
