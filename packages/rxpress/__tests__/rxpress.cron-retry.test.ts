import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import { rxpress } from '../src/rxpress.js';
import type { CronConfig, KVBase, Logger, LogLogger } from '../src/types/index.js';

const logger: Logger = {
  child: () => logger,
  info: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  log: () => undefined,
  addListener: (_cb: LogLogger) => undefined,
};

const kvMap = new Map<string, unknown>();
const kv: KVBase = {
  set: (key, value) => {
    kvMap.set(key, value);
  },
  get: <T = unknown>(key: string) => kvMap.get(key) as T | undefined,
  has: (key) => kvMap.has(key),
  del: (key) => {
    kvMap.delete(key);
  },
};

await rxpress.stop().catch(() => {});

await (async () => {
  rxpress.init({
    config: { port: 0, loadEnv: false },
    logger,
    kv,
  });

  let attempts = 0;

  const cronConfig: CronConfig = {
    cronTime: '*/1 * * * * *',
    retry: {
      maxRetries: 2,
      delayMs: 50,
    },
    handler: async (_now, { logger: cronLogger }) => {
      attempts += 1;

      if (attempts < 3) {
        throw new Error(`fail-${attempts}`);
      }

      cronLogger.info('cron finally succeeded');
      kv.set('cron-success', attempts);
    },
  };

  rxpress.addCrons(cronConfig);
  const { server } = await rxpress.start({ port: 0 });

  try {
    const address = server.address();
    assert.ok(address, 'server did not start');

    const maxWaitMs = 2_000;
    const end = Date.now() + maxWaitMs;

    while (!kv.get('cron-success') && Date.now() < end) {
      await delay(25);
    }

    assert.equal(attempts, 3, 'cron should run initial + two retries');
    assert.equal(kv.get('cron-success'), 3);
    console.info('rxpress.cron-retry success path passed');
  }
  finally {
    await rxpress.stop();
    kvMap.clear();
  }
})();

await (async () => {
  rxpress.init({
    config: { port: 0, loadEnv: false },
    logger,
    kv,
  });

  let attempts = 0;

  const cronConfig: CronConfig = {
    cronTime: '*/1 * * * * *',
    retry: {
      maxRetries: 1,
      delayMs: 10,
    },
    handler: async () => {
      attempts += 1;

      if (attempts === 1) {
        return { retryMs: 5 };
      }

      kv.set('cron-custom-retry', attempts);
    },
  };

  rxpress.addCrons(cronConfig);
  const { server: _server, port: _port } = await rxpress.start({ port: 0 });

  try {
    const end = Date.now() + 1_000;

    while (!kv.get('cron-custom-retry') && Date.now() < end) {
      await delay(10);
    }

    assert.equal(attempts, 2, 'cron should retry once via handler return');
    assert.equal(kv.get('cron-custom-retry'), 2);
    console.info('rxpress.cron-retry custom delay path passed');
  }
  finally {
    await rxpress.stop();
    kvMap.clear();
  }
})();
