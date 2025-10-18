import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { rxpress } from '../src/rxpress.js';
import type { Logger, KVBase, RPCConfig, LogLogger } from '../src/types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'fixtures', 'grpc');
const discoveryDir = fs.mkdtempSync(path.join(tmpdir(), 'rxpress-grpc-'));
const discoveryFile = path.join(discoveryDir, 'discovery.json');

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

const TEST_TIMEOUT_MS = 20_000;
const testTimeout = setTimeout(() => {
  console.error('[grpc-discovery-test] timed out');
  process.exit(1);
}, TEST_TIMEOUT_MS);

await (async () => {
  const targetPort = await getFreePort();
  const TARGET_URL = `127.0.0.1:${targetPort}`;

  console.info('[grpc-discovery-test] using target port', TARGET_URL);

  logs.length = 0;
  store.clear();
  fs.writeFileSync(discoveryFile, JSON.stringify([{ target: '127.0.0.1:59997' }]));

  rxpress.init({
    config: {
      port: 0,
      loadEnv: false,
      grpc: {
        bind: TARGET_URL,
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
    console.info('[grpc-discovery-test] starting server');
    startResult = await rxpress.start({ port: 0 });
    const address = startResult.server.address();
    const listenPort = typeof address === 'object' && address ? address.port : startResult.port;
    console.info('[grpc-discovery-test] server listening', listenPort);

    await runRequest({ listenPort, targetUrl: TARGET_URL, startResult });
  }
  catch (error) {
    await rxpress.stop().catch(() => {});
    throw error;
  }

  await rxpress.stop().catch(() => {});
  console.info('rxpress.grpc-discovery run tests passed');
})()
  .catch((error) => {
    console.error('[grpc-discovery-test] failed', error);
    process.exitCode = 1;
  })
  .finally(() => {
    clearTimeout(testTimeout);
    fs.rmSync(discoveryDir, { recursive: true, force: true });
  });

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((err) => {
        if (err) {
          reject(err);
        }
        else {
          resolve(port);
        }
      });
    });
  });
}

async function runRequest(param: { listenPort: number; targetUrl: string; startResult: Awaited<ReturnType<typeof rxpress.start>> }) {
  const { listenPort, targetUrl } = param;

  console.info('[grpc-discovery-test] updating discovery file to actual target');
  fs.writeFileSync(discoveryFile, JSON.stringify([{ target: targetUrl }]));

  const deadline = Date.now() + 5_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      console.info('[grpc-discovery-test] sending request to discovered route');
      const response = await fetch(`http://127.0.0.1:${listenPort}/discovered`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ping: true }),
      });

      if (response.status !== 200) {
        lastError = new Error(`unexpected status ${response.status}`);
      }
      else {
        const body = await response.json() as any;
        assert.equal(body.ok, true);
        assert.equal(body.source, 'healthy');
        return;
      }
    }
    catch (error) {
      lastError = error;
    }

    await delay(200);
  }

  throw lastError ?? new Error('request never succeeded');
}
