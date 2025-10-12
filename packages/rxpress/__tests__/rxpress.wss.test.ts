import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Buffer } from 'node:buffer';
import WebSocket from 'ws';

import { rxpress } from '../src/rxpress.js';
import type { EventConfig, KVBase, Logger, LogLogger } from '../src/types/index.js';

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

  const connectionEvents: unknown[] = [];
  const messageEvents: unknown[] = [];
  const routedEvents: unknown[] = [];

  const events: EventConfig[] = [
    {
      subscribe: ['SYS::WSS::CONNECTION'],
      handler: async (payload) => {
        connectionEvents.push(payload);
      },
    },
    {
      subscribe: ['SYS::WSS::MESSAGE'],
      handler: async (payload) => {
        messageEvents.push(payload);
      },
    },
    {
      subscribe: ['SYS::WSS::ROUTE::ping'],
      handler: async (payload) => {
        routedEvents.push(payload);
      },
    },
  ];

  rxpress.addEvents(events);

  let startResult: Awaited<ReturnType<typeof rxpress.start>> | null = null;

  try {
    startResult = await rxpress.start({ port: 0 });
  }
  catch (error) {
    if (isPermissionError(error)) {
      console.warn('[rxpress] websocket test skipped due to listen permissions');
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

    const client = new WebSocket(`ws://127.0.0.1:${port}/`);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 1_000);
      client.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      client.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    await delay(20);
    assert.equal(connectionEvents.length, 1, 'expected SYS::WSS::CONNECTION event');

    const pingPayload = { path: 'ping', message: 'hello' };
    client.send(JSON.stringify(pingPayload));

    await delay(25);

    assert.equal(messageEvents.length, 1, 'expected SYS::WSS::MESSAGE event');
    const routedEvent = routedEvents.at(0) as { data?: unknown } | undefined;
    assert.ok(routedEvent, 'expected SYS::WSS::ROUTE::ping event');
    const message = routedEvent?.data as unknown;
    const receivedString = (() => {
      if (!message) {
        return '';
      }

      if (typeof message === 'string') {
        return message;
      }

      if (Buffer.isBuffer(message)) {
        return message.toString();
      }

      if (message instanceof ArrayBuffer) {
        return Buffer.from(message).toString();
      }

      if (Array.isArray(message)) {
        return Buffer.concat(
          message.map((part) => (Buffer.isBuffer(part) ? part : Buffer.from(part as ArrayBuffer))),
        ).toString();
      }

      if (ArrayBuffer.isView(message)) {
        return Buffer.from(message.buffer).toString();
      }

      return Buffer.from(`${message}`).toString();
    })();
    assert.ok(receivedString.includes('"message":"hello"'));

    client.close();
    await delay(20);
    console.info('rxpress.wss passed');
  }
  finally {
    await rxpress.stop();
  }
})();
