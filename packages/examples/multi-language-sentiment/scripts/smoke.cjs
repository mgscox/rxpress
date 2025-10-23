#!/usr/bin/env node

const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { resolve, join } = require('node:path');
const { existsSync } = require('node:fs');

const exampleRoot = resolve(__dirname, '..');
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
};

let pythonProc;
let nodeProc;
const toCleanup = [];

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', shutdown);

async function main() {
  try {
    await startNode();
    await startPython();
    await verifyRequest();
    console.log('Smoke test succeeded.');
  } catch (error) {
    console.error('Smoke test failed:', error);
    process.exitCode = 1;
  } finally {
    shutdown();
  }
}

async function startNode() {
  nodeProc = spawn('node', ['dist/main.js'], {
    cwd: exampleRoot,
    env: {
      ...process.env,
      PORT: String(CONFIG.httpPort),
      GRPC_HOST: '127.0.0.1',
      GRPC_PORT: CONFIG.pythonInvoker.split(':')[1],
      GRPC_BRIDGE_BIND: CONFIG.grpcBridgeBind,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  toCleanup.push(() => killProcess(nodeProc));
  await waitForOutput(nodeProc, /multi-language-sentiment example running/, 10000, 'rxpress');
}

async function startPython() {
  pythonProc = spawn(PYTHON_BIN, ['python/sentiment/server.py'], {
    cwd: exampleRoot,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      BRIDGE_BIND: CONFIG.pythonInvoker,
      CONTROL_TARGET: CONFIG.grpcBridgeBind,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  toCleanup.push(() => killProcess(pythonProc));
  await waitForOutput(pythonProc, /Sentiment bridge listening/, 10000, 'python');
}

async function verifyRequest() {
  const response = await fetch(`http://127.0.0.1:${CONFIG.httpPort}/api/sentiment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'I love this bridge demo' }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  if (!body?.provider) {
    console.error('Response payload:', body);
    throw new Error('Unexpected response payload');
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

function shutdown() {
  while (toCleanup.length) {
    try {
      const fn = toCleanup.pop();
      fn && fn();
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }
}

function killProcess(proc) {
  if (!proc || proc.killed) {
    return;
  }

  try {
    proc.kill('SIGINT');
  } catch (error) {
    console.error('Failed to send SIGINT:', error);
  }

  setTimeout(() => {
    if (!proc.killed) {
      try {
        proc.kill('SIGTERM');
      } catch (error) {
        console.error('Failed to send SIGTERM:', error);
      }
    }
  }, 2000).unref();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  shutdown();
});
