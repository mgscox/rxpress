# rxpress

Reactive orchestration layer that pairs Express with RxJS to manage HTTP routes, event flows, and cron jobs in one place. The library bootstraps your application, leaving logger and key-value adapters up to you.

## Installation

```bash
npm install rxpress
```

## Quick Start (ESM)

Example adapters live under [`src/helpers/`](./src/helpers). Import them into your application or treat them as blueprints for your own infrastructure.

```ts
import { rxpress } from 'rxpress';
import type { RPCConfig } from 'rxpress/types';

import { createSimpleLogger } from './src/helpers/simple-logger.service.js';
import { createMemoryKv } from './src/helpers/memory-kv.service.js';

const logger = createSimpleLogger();
const kv = createMemoryKv('example-app');

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

Bring your own logger and KV implementations. The helper implementations in [`src/helpers/simple-logger.service.ts`](./src/helpers/simple-logger.service.ts) and [`src/helpers/memory-kv.service.ts`](./src/helpers/memory-kv.service.ts) are small, copyable examples. The library keeps adapters out of the publish payload so you can supply console, pino, Redis, memory, or any other implementation that matches the interfaces in `rxpress/src/types`.
