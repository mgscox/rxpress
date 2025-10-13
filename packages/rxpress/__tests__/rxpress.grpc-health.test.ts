import type { AddressInfo } from 'net';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { rxpress } from '../src/rxpress.js';
import type { Logger, KVBase, RPCConfig, LogLogger } from '../src/types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures', 'grpc');

const logs: Array<{ level: string; msg: string; meta?: Record<string, unknown> }> = [];

const logger: Logger = {
  child: () => logger,
  info: (msg, meta) => logs.push({ level: 'info', msg, meta }),
  error: (msg, meta) => logs.push({ level: 'error', msg, meta }),
  debug: (msg, meta) => logs.push({ level: 'debug', msg, meta }),
  warn: (msg, meta) => logs.push({ level: 'warn', msg, meta }),
  log: (payload) => logs.push({ level: payload.level, msg: payload.msg, meta: payload.meta }),
  addListener: (_callback: LogLogger) => undefined,
};

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
  logs.length = 0;

  rxpress.init({
    config: {
      port: 0,
      loadEnv: false,
      grpc: {
        bind: '127.0.0.1:0',
        localHandlers: path.join(fixturesDir, '*.ts'),
        healthCheck: { intervalMs: 200, timeoutMs: 100 },
        registry: {
          'switchable': {
            endpoints: [
              { target: '127.0.0.1:59998', healthCheck: { intervalMs: 200, timeoutMs: 50 } },
              {},
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
    startResult = await rxpress.start({ port: 0 });
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

  // Allow initial probes to mark the first endpoint unhealthy
  await delay(400);

  const response = await fetch(`http://127.0.0.1:${port}/health-check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hello: 'world' }),
  });
  const body = await response.json() as any;
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.source, 'healthy');
  assert.equal(body.echo?.body?.hello, 'world');

  await rxpress.stop().catch(() => {});
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
}).finally(process.exit);
