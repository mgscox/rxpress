import assert from 'node:assert/strict';

import { rxpress } from '../src/rxpress.js';
import type { Logger, KVBase, LogLogger } from '../src/types/index.js';

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

await rxpress.stop().catch(() => {});

await (async () => {
  let prepared = false;
  let closed = false;
  const handled: string[] = [];

  rxpress.init({
    config: {
      port: 0,
      loadEnv: false,
      next: {
        factory: async () => ({
          async prepare() {
            prepared = true;
          },
          async close() {
            closed = true;
          },
          getRequestHandler() {
            return async (req, res) => {
              handled.push(req.url ?? '');
              res.statusCode = 200;
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ via: 'next' }));
            };
          },
        }),
      },
    },
    logger,
    kv,
  });

  const { port } = await rxpress.start({ port: 0 });

  try {
    const response = await fetch(`http://127.0.0.1:${port}/next-health`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload, { via: 'next' });
    assert.equal(handled.length, 1);
    assert.equal(handled[0], '/next-health');
    assert.equal(prepared, true, 'Next factory prepare was not called');
    console.info('rxpress.next tests passed');
  }
  finally {
    await rxpress.stop();
    assert.equal(closed, true, 'Next factory close was not called');
  }
})();
