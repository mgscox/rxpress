import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { rxpress } from '../src/rxpress.js';
import type { Logger, KVBase, LogLogger, RPCConfig } from '../src/types/index.js';

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
  const rootDir = await mkdtemp(join(tmpdir(), 'rxpress-static-root-'));
  const overrideDir = await mkdtemp(join(tmpdir(), 'rxpress-static-override-'));

  await writeFile(join(rootDir, 'default.txt'), 'default-root');
  await writeFile(join(overrideDir, 'override.txt'), 'override-root');

  const routes: RPCConfig[] = [
    {
      type: 'http',
      method: 'GET',
      path: '/static/default',
      staticRoute: {
        filename: 'default.txt',
      },
    },
    {
      type: 'http',
      method: 'GET',
      path: '/static/override',
      staticRoute: {
        filename: 'override.txt',
        options: {
          root: overrideDir,
        },
      },
    },
    {
      type: 'http',
      method: 'GET',
      path: '/static/missing',
      staticRoute: {
        filename: 'missing.txt',
      },
    },
  ];

  rxpress.init({
    config: {
      port: 0,
      loadEnv: false,
      staticRoutDir: rootDir,
    },
    logger,
    kv,
  });

  rxpress.addHandlers(routes);

  const { server, port: requestedPort } = await rxpress.start({ port: 0 });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;

  try {
    const baseUrl = `http://127.0.0.1:${port}`;

    const defaultResponse = await fetch(`${baseUrl}/static/default`);
    assert.equal(defaultResponse.status, 200);
    assert.equal(await defaultResponse.text(), 'default-root');

    const overrideResponse = await fetch(`${baseUrl}/static/override`);
    assert.equal(overrideResponse.status, 200);
    assert.equal(await overrideResponse.text(), 'override-root');

    const missingResponse = await fetch(`${baseUrl}/static/missing`);
    assert.equal(missingResponse.status, 404);
    assert.equal(await missingResponse.text(), 'Resource not found');

    console.info('rxpress.static tests passed');
  }
  finally {
    await rxpress.stop();
    await Promise.all([
      rm(rootDir, { recursive: true, force: true }),
      rm(overrideDir, { recursive: true, force: true }),
    ]);
  }
})();
