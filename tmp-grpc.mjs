import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rxpress } from './packages/rxpress/dist/rxpress.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, 'packages/rxpress/__tests__/fixtures/grpc');

const logs = [];
const logger = {
  child: () => logger,
  info: (...args) => console.log('[info]', ...args),
  error: (...args) => console.log('[error]', ...args),
  debug: (...args) => console.log('[debug]', ...args),
  warn: (...args) => console.log('[warn]', ...args),
  log: (payload) => console.log('[log]', payload),
};

const store = new Map();
const kv = {
  set: (k, v) => store.set(k, v),
  get: (k) => store.get(k),
  has: (k) => store.has(k),
  del: (k) => store.delete(k),
};

await rxpress.stop().catch(() => {});

rxpress.init({
  config: {
    port: 0,
    loadEnv: false,
    grpc: {
      bind: '127.0.0.1:0',
      localHandlers: path.join(fixturesDir, '*.js'),
      healthCheck: { intervalMs: 200, timeoutMs: 100 },
      registry: {
        switchable: {
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

const route = {
  type: 'api',
  method: 'POST',
  path: '/health-check',
  kind: 'grpc',
  grpc: { handlerName: 'healthy-handler', service: 'switchable' },
};

rxpress.addHandlers(route);

try {
  const { port } = await rxpress.start({ port: 0 });
  console.log('started on', port);
  await delay(500);
  const res = await fetch(`http://127.0.0.1:${port}/health-check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hello: 'world' }),
  });
  console.log('status', res.status);
  console.log('body', await res.text());
} catch (err) {
  console.error('FAILED', err);
}
