import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { rxpress } from '../src/rxpress.js';
import type { Logger, KVBase, RPCConfig, LogLogger } from '../src/types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures', 'grpc');
const discoveryFile = path.join(fixturesDir, 'discovery.json');

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

await rxpress.stop().catch(() => {});

await (async () => {
  logs.length = 0;
  store.clear();
  fs.writeFileSync(discoveryFile, JSON.stringify([{ target: '127.0.0.1:59997' }]));

  rxpress.init({
    config: {
      port: 0,
      loadEnv: false,
      grpc: {
        bind: '127.0.0.1:50062',
        localHandlers: path.join(fixturesDir, '*.ts'),
        registry: {
          discovered: {
            discover: {
              type: 'file',
              path: discoveryFile,
              intervalMs: 100,
            },
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
    path: '/discovered',
    kind: 'grpc',
    grpc: {
      handlerName: 'healthy-handler',
      service: 'discovered',
    },
  };

  rxpress.addHandlers(route);

  let startResult: Awaited<ReturnType<typeof rxpress.start>> | null = null;

  try {
    startResult = await rxpress.start({ port: 0 });
  }
  catch (error) {
    await rxpress.stop().catch(() => {});
    throw error;
  }

  // Update discovery file to include the actual target
  fs.writeFileSync(discoveryFile, JSON.stringify([
    { target: '127.0.0.1:50062' },
  ]));

  await delay(200);

  const response = await fetch(`http://127.0.0.1:${startResult!.port}/discovered`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ping: true }),
  });

  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.ok, true);
  assert.equal(body.source, 'healthy');

  await rxpress.stop().catch(() => {});
  fs.rmSync(discoveryFile);
})();
