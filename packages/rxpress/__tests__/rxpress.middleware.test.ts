import assert from 'node:assert/strict';
import express from 'express';

import { rxpress } from '../src/rxpress.js';
import type { KVBase, Logger, RPCConfig } from '../src/types/index.js';

const logger: Logger = {
  child: () => logger,
  info: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  log: () => undefined,
  addListener: () => undefined,
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

rxpress.init({
  config: { port: 0, loadEnv: false },
  logger,
  kv,
});

const parseForm = express.urlencoded({ extended: false });
const calls: Array<string> = [];

rxpress.use((req, _res, next) => {
  calls.push(req.method ?? 'UNKNOWN');
  next();
});
rxpress.use(parseForm);

const submitRoute: RPCConfig = {
  type: 'api',
  method: 'POST',
  path: '/forms/contact',
  handler: async (req) => {
    const body = req.body as Record<string, unknown>;
    return { status: 200, body: { name: body.name } };
  },
};

rxpress.addHandlers(submitRoute);

const { server, port } = await rxpress.start({ port: 0 });

const params = new URLSearchParams({ name: 'rxpress' });
const response = await fetch(`http://127.0.0.1:${port}/forms/contact`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: params.toString(),
});

assert.equal(response.status, 200);
const json = await response.json();
assert.deepEqual(json, { name: 'rxpress' });
assert.ok(calls.includes('POST'), 'global middleware should have run before handler');

await rxpress.stop();
await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve(undefined))));

console.info('rxpress.middleware tests passed');
