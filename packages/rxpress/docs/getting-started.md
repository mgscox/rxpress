# Getting Started

This guide walks through the minimal steps required to bootstrap an application with `rxpress`.

## Prerequisites

- Node.js 20 or newer
- npm (comes with Node.js)
- TypeScript project configured with ESM (`"type": "module"` in `package.json`)

## Install

```bash
npm install rxpress
```

You bring your own logger and key/value adapters. Copy the reference implementations from [`src/helpers`](../src/helpers) or wire in your existing infrastructure.

```ts
// adapters/logger.ts
import pino from 'pino';
import type { Logger, LogLogger } from 'rxpress';

const base = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export const logger: Logger = {
  child(meta) {
    const child = base.child(meta);
    return { ...logger, info: child.info.bind(child) };
  },
  info: (...args) => base.info(...args),
  error: (...args) => base.error(...args),
  debug: (...args) => base.debug(...args),
  warn: (...args) => base.warn(...args),
  log: (payload) => base.info(payload),
  addListener(_cb: LogLogger) {
    /* optional: forward structured logs elsewhere */
  },
};
```

```ts
// adapters/kv.ts
import type { KVBase } from 'rxpress';

const memory = new Map<string, unknown>();

export const kv: KVBase = {
  set: (key, value) => memory.set(key, value),
  get: (key) => memory.get(key),
  has: (key) => memory.has(key),
  del: (key) => memory.delete(key),
};
```

## Bootstrapping

```ts
import { rxpress } from 'rxpress';
import type { RPCConfig, EventConfig } from 'rxpress';
import { logger } from './adapters/logger.js';
import { kv } from './adapters/kv.js';

const routes: RPCConfig[] = [
  {
    type: 'api',
    method: 'GET',
    path: '/health',
    handler: async (_req, { emit }) => {
      emit({ topic: 'audit::health', data: { timestamp: Date.now() } });
      return { status: 200, body: { ok: true } };
    },
  },
];

const events: EventConfig[] = [
  {
    subscribe: ['audit::health'],
    handler: async (payload, { logger }) => logger.info('Audit', payload as object),
  },
];

rxpress.init({
  config: {
    port: 3000,
    loadEnv: true,
    metrics: {
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    },
  },
  logger,
  kv,
});

rxpress.addHandlers(routes);
rxpress.addEvents(events);

await rxpress.start({ port: 3000 });
```

See the next section for optional security middleware (Helmet, cookie-session) that keeps the server stateless while adding HTTP header protections and encrypted sessions.

## Optional Security Middleware

`rxpress` keeps middleware opt-in so you can start small. To enable [Helmet](https://helmetjs.github.io/) with its defaults and add encrypted cookie sessions via [`cookie-session`](https://github.com/expressjs/cookie-session), provide the `helmet` and `session` blocks during `init`:

```ts
rxpress.init({
  config: {
    port: 3000,
    helmet: {},
    session: {
      name: 'sessionId',
      secret: process.env.SESSION_SECRET ?? 'replace-me',
      maxAge: 24 * 60 * 60 * 1000,
    },
  },
  logger,
  kv,
});
```

The example server (`packages/server/src/main.ts`) demonstrates combining these with telemetry and other options.

## Request Parsers & Custom Middleware

The Express app lives inside the library, but you can still install middleware in two ways.

### Global middleware via `rxpress.use`

We include common middleware, such as `helmet`, `session`, and `json-body-parser`, in the main library. To add additional middleware, simply call `rxpress.use` (after `rxpress.init`) to register middleware that should run for every request. This is the easiest place to plug in packages like [`compression`](https://github.com/expressjs/compression) or [`cors`](https://github.com/expressjs/cors):

```ts
import compression from 'compression';
import cors from 'cors';

rxpress.init({
  /* ... */
});

rxpress.use(compression());
rxpress.use(cors({ origin: 'https://app.example.com' }));
```

`rxpress.use` mirrors `express().use`, so you can also pass path-prefixed middleware (`rxpress.use('/admin', authMiddleware)`), error handlers, or arrays of handlers. Ensure you call it before `rxpress.start`.

### Per-route middleware

Global middleware can be computationally expensive, since it runs on every route every time. When you only need a parser or guard on a specific handler, attach it through the `middleware` array on the route definition. For example, to accept classic HTML form posts (`application/x-www-form-urlencoded`):

```ts
import express from 'express';
import type { RPCConfig } from 'rxpress';

const parseForm = express.urlencoded({ extended: false });

const submitForm: RPCConfig = {
  type: 'api',
  method: 'POST',
  path: '/forms/contact',
  middleware: [parseForm],
  handler: async (req) => {
    return { status: 204, body: {} };
  },
};
```

Attach `parseForm` only where you need it, or reuse the same instance across multiple routes. Global JSON parsing is already configured via `express.json()`; adjust its options through `config.json` (for example `limit: '2mb'`) when you call `rxpress.init`.

## Auto-loading by Convention

Instead of registering handlers programmatically, supply directories that contain `*.handler.js`, `*.event.js`, or `*.cron.js` files. Each module should export a `config` object compatible with the respective type.

```ts
await rxpress.load({
  handlerDir: new URL('./handlers', import.meta.url).pathname,
  eventDir: new URL('./events', import.meta.url).pathname,
  cronDir: new URL('./crons', import.meta.url).pathname,
});
```

If you author handlers in TypeScript, compile them as part of your build step and point `handlerDir`/`eventDir`/`cronDir` at the emitted JavaScript (for example, `dist/handlers`). This keeps the runtime loading simple while letting you maintain source files in `src/`.

With this in place you can keep feature-specific logic next to its schema definitions and co-locate tests.

## Generating OpenAPI Specs

`rxpress` can emit an OpenAPI document describing your routes. Enable the generator when initialising the server:

```ts
rxpress.init({
  config: {
    documentation: {
      enabled: true,
      version: '1.0.0',
      title: 'Starter API',
      path: '/openapi.json',
    },
  },
  logger,
  kv,
});
```

After the server starts, fetch the spec from `/openapi.json` and feed it to Swagger UI, ReDoc, or code generators.
