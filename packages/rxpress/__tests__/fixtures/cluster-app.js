import cluster from 'node:cluster';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { rxpress } from '../../dist/rxpress.js';
import { assert } from 'node:console';

console.log(`[cluster-app] module loaded pid=${process.pid} primary=${cluster.isPrimary}`);

if (cluster.isPrimary) {
  const execPath = fileURLToPath(import.meta.url);
  cluster.setupPrimary({ exec: execPath, execArgv: process.execArgv, args: process.argv.slice(2), silent: true });

  cluster.on('fork', (worker) => {
    console.log(`[cluster-app] forked worker pid=${worker.process.pid}`);
    worker.process.stdout.on('data', (data) => {
      process.stdout.write(`[worker:${worker.process.pid}] ${data}`);
    });
    worker.process.stderr.on('data', (data) => {
      process.stderr.write(`[worker:${worker.process.pid}:err] ${data}`);
    });
  });

  cluster.on('exit', (worker, code, signal) => {
    console.log(`[cluster-app] worker ${worker.process.pid} exited code=${code} signal=${signal}`);
  });
}
else {
  console.log(`[cluster-app] worker bootstrap starting pid=${process.pid}`);
}

const logger = {
  child: () => logger,
  info: () => undefined,
  error: () => {
    assert.ok(false, 'No errors expected')
  },
  debug: () => undefined,
  warn: () => undefined,
  log: () => undefined,
};

const kvStore = new Map();
const kv = {
  set: (key, value) => {
    kvStore.set(key, value);
  },
  get: (key) => kvStore.get(key),
  has: (key) => kvStore.has(key),
  del: (key) => {
    kvStore.delete(key);
  },
};

const broadcastRoute = {
  type: 'api',
  method: 'POST',
  path: '/broadcast',
  emits: ['SYS::WSS::BROADCAST'],
  middleware: [],
  handler: async (_req, ctx) => {
    ctx.emit({
      topic: 'SYS::WSS::BROADCAST',
      data: {
        payload: { message: 'cluster hello' },
      },
    });

    return {
      status: 202,
      body: { ok: true },
    };
  },
};

const isPermissionError = (error) => {
  if (!error) {
    return false;
  }

  const message = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : '';

  return /EACCES|EPERM/.test(message);
};

async function main() {
  console.log(`[cluster-app] bootstrap pid=${process.pid} primary=${cluster.isPrimary}`);

  process.on('exit', (code) => {
    console.log(`[cluster-app] process ${process.pid} exiting with code ${code}`);
  });

  let keepAliveTimer = null;

  await rxpress.stop().catch(() => {});

  rxpress.init({
    config: {
      port: 3987,
      hostname: '127.0.0.1',
      loadEnv: false,
      cluster: {
        workers: 2,
        restartOnExit: false,
      },
    },
    logger,
    kv,
  });

  rxpress.addHandlers(broadcastRoute);

  let startResult;

  try {
    startResult = await rxpress.start();
  }
  catch (error) {
    console.error('[cluster-app] start failed', error);

    if (isPermissionError(error)) {
      console.log(JSON.stringify({ type: 'skip', reason: 'listen-permission' }));
      await rxpress.stop().catch(() => {});
      process.exit(0);
    }

    process.exit(1);
  }
  const startPort = startResult.port;
  console.log('[cluster-app] startResult', JSON.stringify({ port: startResult.port }));

  if (!startPort || typeof startPort !== 'number') {
    throw new Error('[cluster-app] failed to acquire listening port');
  }

  console.log('[cluster-app] start completed, port resolved');

  if (cluster.isPrimary) {
    console.log('[cluster-app] primary ready to announce port');
    console.log(JSON.stringify({ type: 'ready', port: startPort }));
  }

  if (cluster.isPrimary) {
    keepAliveTimer = setInterval(() => {}, 1 << 30);

    process.on('message', async (message) => {
      if (!message || typeof message !== 'object') {
        return;
      }

      if (message.type === 'shutdown') {
        if (keepAliveTimer) {
          clearInterval(keepAliveTimer);
          keepAliveTimer = null;
        }
        await rxpress.stop().catch(() => {});
        await delay(10);
        process.exit(0);
      }
    });
  }
  else {
    keepAliveTimer = setInterval(() => {}, 1 << 30);
  }

  const shutdown = async () => {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
    await rxpress.stop().catch(() => {});
    await delay(10);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise(() => {});
}

main().catch((error) => {
  console.error('[cluster-app] fatal error', error);
  process.exit(1);
});
