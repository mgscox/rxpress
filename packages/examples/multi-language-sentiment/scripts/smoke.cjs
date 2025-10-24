#!/usr/bin/env node

const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { resolve, join } = require('node:path');
const { existsSync } = require('node:fs');

const exampleRoot = resolve(__dirname, '..');
const TIMEOUT_SEC = Number(process.env.SMOKE_TIMEOUT_SEC ?? '45');

const defaultPython = (() => {
  const binDir = process.platform === 'win32' ? 'Scripts' : 'bin';
  const binary = process.platform === 'win32' ? 'python.exe' : 'python';
  const candidate = join(exampleRoot, '.venv', binDir, binary);
  if (existsSync(candidate)) {
    return candidate;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
})();
const PYTHON_BIN = process.env.PYTHON || defaultPython;

const CONFIG = {
  httpPort: 3180,
  grpcBridgeBind: '127.0.0.1:52070',
  pythonInvoker: '127.0.0.1:52055',
  goInvoker: '127.0.0.1:52065',
};

let pythonProc;
let goProc;
let nodeProc;
const toCleanup = [];

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('exit', () => void shutdown());

async function main() {
  try {
    await startNode();
    await runBackend('python', startPython);
    await runBackend('go', startGo);
    console.log('Smoke test succeeded.');
  } catch (error) {
    console.error('Smoke test failed:', error);
    process.exitCode = 1;
  } finally {
    await shutdown();
  }
}

async function startNode() {
  const command = `timeout --foreground ${TIMEOUT_SEC}s node dist/main.js`;
  nodeProc = spawn('bash', ['-lc', command], {
    cwd: exampleRoot,
    env: {
      ...process.env,
      PORT: String(CONFIG.httpPort),
      GRPC_HOST: '127.0.0.1',
      GRPC_PORT: CONFIG.pythonInvoker.split(':')[1],
      GRPC_BRIDGE_BIND: CONFIG.grpcBridgeBind,
      PYTHON_GRPC_HOST: CONFIG.pythonInvoker.split(':')[0],
      PYTHON_GRPC_PORT: CONFIG.pythonInvoker.split(':')[1],
      GO_GRPC_HOST: CONFIG.goInvoker.split(':')[0],
      GO_GRPC_PORT: CONFIG.goInvoker.split(':')[1],
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  toCleanup.push(() => terminate(nodeProc, 'rxpress'));
  await waitForOutput(nodeProc, /multi-language-sentiment example running/, 10000, 'rxpress');
}

async function startPython() {
  const execute = `timeout --foreground ${TIMEOUT_SEC}s ${JSON.stringify(PYTHON_BIN)} python/sentiment/server.py`;
  pythonProc = spawn('bash', ['-lc', execute], {
    cwd: exampleRoot,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      BRIDGE_BIND: CONFIG.pythonInvoker,
      CONTROL_TARGET: CONFIG.grpcBridgeBind,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  toCleanup.push(() => terminate(pythonProc, 'python'));
  await waitForOutput(pythonProc, /Sentiment bridge listening/, 10000, 'python');
}

async function startGo() {
  const bridgeRoot = resolve(exampleRoot, '..', '..', 'rxpress-bridge-go');
  const cmd = `timeout --foreground ${TIMEOUT_SEC}s go run ./cmd/sentiment`;
  goProc = spawn('bash', ['-lc', cmd], {
    cwd: bridgeRoot,
    env: {
      ...process.env,
      BRIDGE_BIND: CONFIG.goInvoker,
      CONTROL_TARGET: CONFIG.grpcBridgeBind,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  toCleanup.push(() => terminate(goProc, 'go'));
  await waitForOutput(goProc, /Go sentiment bridge listening/, 15000, 'go');
}

async function runBackend(id, starter) {
  await starter();
  try {
    await verifyRequest(id);
  } finally {
    const proc = id === 'python' ? pythonProc : goProc;
    await terminate(proc, id);
    if (id === 'python') {
      pythonProc = undefined;
    } else {
      goProc = undefined;
    }
    await delay(200);
  }
}

async function verifyRequest(backend) {
  const response = await fetch(`http://127.0.0.1:${CONFIG.httpPort}/api/sentiment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'I love this bridge demo', backend }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  if (!body?.provider) {
    console.error('Response payload:', body);
    throw new Error('Unexpected response payload');
  }
  if (body.backend !== backend) {
    console.error('Response payload:', body);
    throw new Error(`backend mismatch – expected ${backend}`);
  }
}

async function waitForOutput(proc, matcher, timeoutMs, label) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(function () {
      reject(new Error(`${label} process did not emit readiness log within ${timeoutMs}ms`));
    }, timeoutMs).unref();

    const check = (text) => {
      if (matcher.test(text)) {
        cleanupListeners();
        resolvePromise();
      }
    };

    const onStdout = (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      check(text);
    };

    const onStderr = (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      check(text);
    };

    const onExit = (code) => {
      cleanupListeners();
      reject(new Error(`${label} process exited with code ${code}`));
    };

    const cleanupListeners = () => {
      clearTimeout(timer);
      proc.stdout?.off('data', onStdout);
      proc.stderr?.off('data', onStderr);
      proc.off('exit', onExit);
    };

    proc.stdout?.on('data', onStdout);
    proc.stderr?.on('data', onStderr);
    proc.once('exit', onExit);
  });
}

async function shutdown() {
  while (toCleanup.length) {
    try {
      const fn = toCleanup.pop();
      const result = fn && fn();
      if (result instanceof Promise) {
        await result;
      }
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }
}

async function terminate(proc, label) {
  if (!proc) {
    return;
  }

  if (proc.exitCode !== null || proc.signalCode) {
    return;
  }

  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(fallback);
      resolve();
    };

    const fallback = setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) {
        try {
          proc.kill('SIGKILL');
        } catch (error) {
          console.error(`Failed to send SIGKILL to ${label}:`, error);
        }
      }
    }, 2000).unref();

    proc.once('exit', cleanup);

    try {
      proc.kill('SIGINT');
    } catch (error) {
      console.error(`Failed to send SIGINT to ${label}:`, error);
    }

    setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) {
        try {
          proc.kill('SIGTERM');
        } catch (error) {
          console.error(`Failed to send SIGTERM to ${label}:`, error);
        }
      }
    }, 500).unref();
  });
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await shutdown();
});
