# rxpress

Reactive orchestration layer that pairs Express with RxJS to manage HTTP routes, event flows, and cron jobs in one place. The library bootstraps your application, leaving logger and key-value adapters up to you.

## Installation

```bash
npm install rxpress
```

## Quick Start (ESM)

```ts
import { rxpress } from 'rxpress';
import type { Logger, KVBase, RPCConfig } from 'rxpress/types';

const logger: Logger = {
  child: () => logger,
  info: (msg, meta) => console.info(msg, meta),
  error: (msg, meta) => console.error(msg, meta),
  debug: (msg, meta) => console.debug(msg, meta),
  warn: (msg, meta) => console.warn(msg, meta),
  log: (payload) => console.log(payload),
};

const store = new Map<string, unknown>();
const kv: KVBase = {
  set: (key, value) => { store.set(key, value); },
  get: (key) => store.get(key),
  has: (key) => store.has(key),
  del: (key) => { store.delete(key); },
};

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
  config: { port: 3000, loadEnv: true },
  logger,
  kv,
});

routes.forEach((route) => rxpress.addHandlers(route));

await rxpress.start({ port: 3000 });
```

## Features

- Declarative RPC configuration with runtime validation using Zod.
- Event bus built on RxJS for request side-effects and cross-cutting concerns.
- Cron job registration with logging and KV context hooks.
- Opt-in OpenTelemetry metrics pipeline.

## Adapters

Bring your own logger and KV implementations. The interfaces live in `rxpress/src/types`. We intend to ship optional adapter packages (console logger, in-memory KV, Redis-backed KV) in a future release.
