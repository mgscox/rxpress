import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import readline from 'node:readline';
import { io as createSocketClient, type Socket } from 'socket.io-client';
import { stderr } from 'node:process';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(CURRENT_DIR, 'fixtures', 'cluster-app.js');
const REPO_ROOT = join(CURRENT_DIR, '..', '..');
const DIST_ENTRY = join(CURRENT_DIR, '..', 'dist', 'rxpress.js');

let buildReady = false;

async function ensureBuild() {
  if (buildReady && existsSync(DIST_ENTRY)) {
    return;
  }

  execFileSync('npm', ['run', 'build', '--workspace', 'rxpress'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  buildReady = true;
}

const createClient = (url: string, label: string) => {
  console.debug(`[rxpress.cluster] Creating socket.io client ${label}`);
  const client: Socket = createSocketClient(url, {
    transports: ['websocket'],
    forceNew: true,
    timeout: 12_000,
  });
  const ready = new Promise<Socket>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Socket (${label}) open timeout`)), 12_000);
    client.once('connect', () => {
      console.debug(`Socket (${label}) successful connection`);
      clearTimeout(timeout);
      resolve(client);
    });
    client.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  return { client, ready };
};

await (async () => {
  await ensureBuild();

  const childFactory = () => {
    console.debug(`[rxpress.cluster] Spawning rxpress server`)
    return spawn(process.execPath, [FIXTURE], {
      cwd: CURRENT_DIR,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  }
    

  const child = childFactory();
  const rl = readline.createInterface({ input: child.stdout, output: stderr });

  try {
    const startup = await Promise.race([
      once(child, 'exit').then(([code, signal]) => ({ kind: 'exit' as const, code, signal })),
      new Promise<{ kind: 'message'; msg: unknown }>((resolve) => {
        rl.on('line', (line) => {
          try {
            const parsed = JSON.parse(line);
            resolve({ kind: 'message', msg: parsed });
          }
          catch {
            // ignore non-JSON log lines
          }
        });
      }),
      delay(10_000).then(() => ({ kind: 'timeout' as const })),
    ]);

    if (startup.kind === 'exit') {
      if (startup.code === 0) {
        console.warn('[rxpress.cluster] skipping test: cluster fixture exited cleanly before ready signal');
        return;
      }

      throw new Error(`cluster fixture exited early (code=${startup.code} signal=${startup.signal})`);
    }

    if (startup.kind === 'timeout') {
      throw new Error('cluster fixture did not signal readiness within 10s');
    }

    const message = startup.msg;

    if (!message || typeof message !== 'object') {
      throw new Error('cluster fixture did not provide startup payload');
    }

    if ((message as { type?: string }).type === 'skip') {
      console.warn('[rxpress.cluster] skipping test:', (message as { reason?: string }).reason);
      child.kill('SIGTERM');
      await once(child, 'exit');
      rl.close();
      return;
    }

    assert.equal((message as { type?: string }).type, 'ready', 'cluster fixture missing ready acknowledgment');
    const port = (message as { port?: number }).port;
    assert.equal(typeof port, 'number', 'cluster fixture missing port');

    const endpoint = `http://127.0.0.1:${port}`;
    const a = createClient(endpoint, 'A');
    const b = createClient(endpoint, 'B');

    const [clientA, clientB] = await Promise.all([a.ready, b.ready]);

    const messages = await Promise.all([
      new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('client A broadcast timeout')), 2_000);
        clientA.once('message', (data) => {
          clearTimeout(timeout);
          resolve(JSON.stringify(data));
        });
      }),
      new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('client B broadcast timeout')), 2_000);
        clientB.once('message', (data) => {
          clearTimeout(timeout);
          resolve(JSON.stringify(data));
        });
      }),
      (async () => {
        const response = await fetch(`http://127.0.0.1:${port}/broadcast`, { method: 'POST' });
        assert.equal(response.status, 202, 'broadcast route did not accept request');
        await response.text();
        return 'done';
      })(),
    ]);

    const payloads = messages.slice(0, 2);
    payloads.forEach((payload) => {
      const parsed = JSON.parse(payload);
      assert.deepEqual(parsed, { message: 'cluster hello' });
    });

    clientA.close();
    clientB.close();
    await delay(20);
    console.info('rxpress.cluster broadcast tests passed');
  }
  finally {
    rl.close();

    child.kill('SIGTERM');
    const exit = await Promise.race([
      once(child, 'exit'),
      delay(5_000).then(() => {
        child.kill('SIGKILL');
        return ['killed', null];
      }),
    ]);

    if (exit && Array.isArray(exit) && exit[0] !== 0 && exit[0] !== 'killed') {
      throw new Error(`cluster fixture exited with code ${exit[0]} signal ${exit[1]}`);
    }
  }
})();
