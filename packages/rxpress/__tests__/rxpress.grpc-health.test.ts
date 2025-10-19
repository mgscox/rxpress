import type { AddressInfo } from 'net';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { rxpress } from '../src/rxpress.js';
import type { Logger, KVBase, RPCConfig } from '../src/types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures', 'grpc');

/*
  Expect first registry endpoint to fail health-check (UNAVAILABLE), causing server to fall back to local handler
  This will cause an error to be logged that connection fails, then a warning the server is no longer available
*/  
let logCount = {error: 0, warn: 0};
const logger: Logger = {
  child: () => (logger),
  addListener: () => {},
  log: () => {},
  debug: () => {},
  info: () => {},
  warn: (msg, _meta) => {
    logCount.warn += 1;
    assert.equal(1, logCount.warn, 'One warning is expected')
    assert.ok(msg.startsWith('gRPC endpoint probe failed'))
  },
  error: (msg, _meta) => {
    logCount.error += 1;
    assert.equal(1, logCount.error, 'One error is expected')
    assert.ok(msg.startsWith('grpc.invoke.error'))
  },
}
const store = new Map<string, unknown>();
const kv: KVBase = {
  set: (key, value) => {
    store.set(key, value);
  },
  get: async <T = unknown>(key: string) => store.get(key) as T | undefined,
  has: (key: string) => store.has(key),
  del: (key: string) => {
    store.delete(key);
  },
};

const isPermissionError = (error: unknown) => {
  if (typeof error === 'string') {
    return /EACCES|EPERM/.test(error);
  }

  if (error instanceof Error) {
    return /EACCES|EPERM/.test(error.message);
  }

  return false;
};

await rxpress.stop().catch(() => {});

await (async () => {
  store.clear();

  rxpress.init({
    config: {
      port: 3987,
      loadEnv: false,
      grpc: {
        bind: '127.0.0.1:0',  // default server (including fallback for failing registries as last resport) - so gRPC will still run
        localHandlers: path.join(fixturesDir, '*.ts'),
        healthCheck: { intervalMs: 200, timeoutMs: 100 },
        registry: {
          'switchable': {
            endpoints: [
              { target: '127.0.0.1:59998', healthCheck: { intervalMs: 200, timeoutMs: 50 } }, // no gRPC hanlder on this port
              {}, // invalid/ undefined
            ],
          },
        },
      },
    },
    logger,
    kv,
  });

  const route: RPCConfig = {
    type: 'api',
    method: 'POST',
    path: '/health-check',
    kind: 'grpc',
    grpc: {
      handlerName: 'healthy-handler',
      service: 'switchable',
    },
  };

  rxpress.addHandlers(route);

  let startResult: Awaited<ReturnType<typeof rxpress.start>> | null = null;

  try {
    startResult = await rxpress.start();
  }
  catch (error) {
    if (isPermissionError(error)) {
      console.warn('Skipping gRPC health integration test due to lack of permissions');
      return;
    }

    throw error;
  }

  const address = startResult!.server.address() as AddressInfo;
  const port = address?.port ?? startResult!.port;

  assert.equal(address?.port, startResult!.port, 'Server running on requested port')

  // Allow initial probes to mark the first endpoint unhealthy
  await delay(400);

  const response = await fetch(`http://127.0.0.1:${port}/health-check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hello: 'world' }),
  });
  assert.equal(response.status, 200, 'Server response is 200');
  const body = await response.json() as Record<string, any>;
  assert.equal(body.ok, true, 'Server is responding (has body)');
  assert.equal(body.source, 'healthy', 'Server source is "healthy"');
  assert.equal(body.echo?.body?.hello, 'world', 'Server body is {"hello":"world"}');

  await rxpress.stop().catch(() => {});
  console.info('rxpress.grpc-health run tests passed');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(async () => {
  await rxpress.stop()
});
