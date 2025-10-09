import assert from 'node:assert/strict';

import { setTimeout as delay } from 'node:timers/promises';

import { rxpress, helpers } from '../src/index.js';
import type { RPCConfig } from '../src/types/index.js';

const { createSimpleLogger, createMemoryKv } = helpers;

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
  const logger = createSimpleLogger();
  const kv = createMemoryKv('readme-example', false);

  const routes: RPCConfig[] = [
    {
      type: 'api',
      method: 'GET',
      path: '/health',
      middleware: [],
      handler: async () => ({ status: 200, body: { ok: true } }),
    },
  ];

  rxpress.init({
    config: { port: 0, loadEnv: false },
    logger,
    kv,
  });

  routes.forEach((route) => rxpress.addHandlers(route));

  let startResult: Awaited<ReturnType<typeof rxpress.start>> | null = null;

  try {
    startResult = await rxpress.start({ port: 0 });
  } 
  catch (error) {
    if (isPermissionError(error)) {
      console.warn('[rxpress] README example test skipped due to listen permissions');
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

    const response = await fetch(`http://127.0.0.1:${port}/health`);

    if (response.status !== 200) {
      const body = await response.text();
      console.error('[rxpress] README example unexpected status', response.status, body);
    }

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload, { ok: true });
    console.info('readme-example tests passed');
  } 
  finally {
    await rxpress.stop();
  }
})();
