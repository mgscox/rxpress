import assert from 'node:assert/strict';

import { setTimeout as delay } from 'node:timers/promises';

import { rxpress } from '../src/rxpress.js';
import type { Logger, KVBase, CronConfig, EventConfig, LogLogger } from '../src/types/index.js';

const logger: Logger = {
  child: () => logger,
  info: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  log: () => undefined,
  addListener: function (callback: LogLogger): void {
    throw new Error('Function not implemented.');
  }
};

const kvStore = new Map<string, unknown>();
const kv: KVBase = {
  set: (key, value) => {
    kvStore.set(key, value);
  },
  get: <T = unknown>(key: string) => kvStore.get(key) as T | undefined,
  has: (key) => kvStore.has(key),
  del: (key) => {
    kvStore.delete(key);
  },
};

await rxpress.stop().catch(() => {});

const result = await (async () => {
  rxpress.init({
    config: { port: 0, loadEnv: false },
    logger,
    kv,
  });

  const triggered: unknown[] = [];
  const cronHandled = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('cron did not fire')), 5_000);
    const handler: EventConfig = {
      subscribe: ['cron::fired'],
      handler: async (input) => {
        triggered.push(input);
        clearTimeout(timeout);
        resolve();
      },
    };
    rxpress.addEvents(handler);
  });

  const cronConfig: CronConfig = {
    cronTime: "*/1 * * * * *",
    handler: (_now, { emit, kv: contextKv }) => {
      contextKv.set('cron-fired', true);
      emit({ topic: 'cron::fired', data: 'tick' });
    },
  };
  rxpress.addCrons(cronConfig);

  const { server } = await rxpress.start({ port: 0 });
  try {
    await cronHandled;
    await delay(50); // give cron handler time to settle
    assert.equal(kv.get('cron-fired'), true);
    assert.deepEqual(triggered, ['tick']);
  } finally {
    await rxpress.stop();
    await delay(10);
  }
})();

export default result;
