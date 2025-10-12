import assert from 'node:assert/strict';
import * as z from 'zod';

import { rxpress } from '../src/rxpress.js';
import type { Logger, KVBase, LogLogger, RPCConfig } from '../src/types/index.js';

const logger: Logger = {
  child: () => logger,
  info: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  log: () => undefined,
  addListener: (_cb: LogLogger) => undefined,
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
  rxpress.init({
    config: {
      port: 0,
      loadEnv: false,
      documentation: {
        enabled: true,
        title: 'Example API',
        version: '2.0.0',
        path: '/openapi.json',
        description: 'Test spec',
      },
    },
    logger,
    kv,
  });

  const routes: RPCConfig[] = [
    {
      type: 'api',
      method: 'POST',
      path: '/users/:id',
      description: 'Update a user',
      bodySchema: z.object({ name: z.string(), email: z.string().email().optional() }),
      responseSchema: z.object({ id: z.string(), name: z.string(), email: z.string().email().optional() }),
      handler: async (_req, { run }) => {
        await run.set('user.id', '123');
        return { status: 200, body: { id: '123', name: 'Jane Doe' } };
      },
    },
    {
      type: 'http',
      method: 'GET',
      path: '/assets/logo',
      staticRoute: {
        filename: 'logo.svg',
      },
    },
  ];

  rxpress.addHandlers(routes);

  const { server, port: requestedPort } = await rxpress.start({ port: 0 });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/openapi.json`);
    assert.equal(response.status, 200);
    const spec = await response.json() as any;

    assert.equal(spec.openapi, '3.0.3');
    assert.equal(spec.info.title, 'Example API');
    assert.equal(spec.info.version, '2.0.0');
    assert.ok(spec.paths['/users/{id}']?.post, 'POST operation missing');
    assert.ok(spec.paths['/assets/logo']?.get, 'Static route missing');
    console.info('rxpress.documentation tests passed');
  }
  finally {
    await rxpress.stop();
    store.clear();
  }
})();
