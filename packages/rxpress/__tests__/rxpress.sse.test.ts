import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import * as z from 'zod';

import { rxpress } from '../src/rxpress.js';
import type { Logger, KVBase, RPCConfig, LogLogger } from '../src/types/index.js';

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

const isPermissionError = (error: unknown) => {
  if (typeof error === 'string') {
    return /EPERM|EACCES/.test(error);
  }

  if (error instanceof Error) {
    return /EPERM|EACCES/.test(error.message);
  }

  return false;
};

await rxpress.stop().catch(() => {});

await (async () => {
  rxpress.init({
    config: { port: 0, loadEnv: false },
    logger,
    kv,
  });

  const route: RPCConfig = {
    type: 'sse',
    method: 'GET',
    path: '/events',
    middleware: [],
    responseSchema: z.object({ message: z.string() }),
    handler: async (_req, ctx) => {
      assert.ok(ctx.stream, 'SSE context stream should be defined');
      ctx.stream.send({ message: 'hello' });
    },
  };

  rxpress.addHandlers(route);

  let startResult: Awaited<ReturnType<typeof rxpress.start>> | null = null;

  try {
    startResult = await rxpress.start({ port: 0 });
  }
  catch (error) {
    if (isPermissionError(error)) {
      console.warn('[rxpress] SSE test skipped due to listen permissions');
      return;
    }

    throw error;
  }

  const { server } = startResult;

  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object', 'server did not bind to an address');
    const port = address.port;

    await delay(25);

    const response = await fetch(`http://127.0.0.1:${port}/events`, {
      headers: {
        Accept: 'text/event-stream',
      },
    });

    assert.equal(response.status, 200);

    const contentType = response.headers.get('content-type');
    assert.ok(contentType?.includes('text/event-stream'), 'expected text/event-stream content type');

    const payload = await response.text();
    assert.ok(
      payload.includes('data: {"message":"hello"}'),
      `expected SSE data frame, received: ${payload}`,
    );
    console.info('rxpress.sse tests passed');
  }
  finally {
    await rxpress.stop();
  }
})();
