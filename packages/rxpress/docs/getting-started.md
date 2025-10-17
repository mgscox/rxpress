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

## Bootstrapping

```ts
import { rxpress, simplelLogger, createMemoryKv } from 'rxpress';
import type { RPCConfig, EventConfig } from 'rxpress';

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
  logger: simpleLogger,
  kv: new createMemoryKv('example'),
});

rxpress.addHandlers(routes);
rxpress.addEvents(events);

rxpress.start().catch(logger.error);
```

See the next section for optional security middleware (Helmet, cookie-session) that keeps the server stateless while adding HTTP header protections and encrypted sessions.

## Optional Security Middleware

`rxpress` keeps middleware opt-in so you can start small. To enable [Helmet](https://helmetjs.github.io/) with its defaults and add encrypted cookie sessions via [`cookie-session`](https://github.com/expressjs/cookie-session), provide the `helmet` and `session` blocks during `init`:

```ts
rxpress.init({
  config: {
    port: 3000,
    helmet: {
      /* you probably don't want a blank helmet configuration! */
    },
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

## gRPC bridge (polyglot handlers)

Need to run business logic outside of Node.js? Enable the gRPC bridge so routes and events can call remote handlers written in any language that supports gRPC.

```ts
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const handlerGlob = path.join(fileURLToPath(new URL('./handlers', import.meta.url)), '*.ts');

rxpress.init({
  config: {
    grpc: {
      bind: '127.0.0.1:0', // start a local in-process bridge (auto-picks a port)
      localHandlers: handlerGlob, // autoload handler files
      registry: {
        local: {},
      },
      // target: 'grpc.internal:50051',  // optional remote bridge
    },
  },
  logger,
  kv,
});

rxpress.addHandlers({
  type: 'api',
  method: 'POST',
  path: '/polyglot',
  kind: 'grpc',
  grpc: { handlerName: 'polyglot-handler', service: 'local' },
});
```

Handlers receive the same context (`emit`, `kv`, `run`, `log`) and can emit additional events or touch run-scoped state. Read [`docs/grpc.md`](./grpc.md) for wiring remote runtimes (Python, Go, Rust, C#, …) and structuring your handler modules.

Add TLS by pointing `grpc.tls` (or per-service overrides) at your PEM files; the bridge will automatically establish mutual TLS when both `certFile` and `keyFile` are present.

Enable proactive health probes by adding `healthCheck` to the bridge or specific endpoints; offline nodes are skipped until probes succeed again.

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

### Streaming operators with `pipes`

Because `rxpress` sits on top of RxJS, every handler is ultimately subscribed to an observable. Routes and events expose an optional `pipes` array so you can insert RxJS operators before your handler runs. Use this hook for cross-cutting concerns such as throttling, sampling, buffering, or inline telemetry.

```ts
import { tap } from 'rxjs/operators';

const auditedRoute: RPCConfig = {
  type: 'api',
  method: 'POST',
  path: '/orders',
  pipes: [
    tap(({ req }) => auditLogger.info('order received', { id: req.headers['x-request-id'] })),
  ],
  handler: async (req) => ({ status: 202, body: { ok: true } }),
};

const countedEvent: EventConfig = {
  subscribe: ['order.created'],
  pipes: [tap(({ data }) => metrics.counter.add(1, { topic: 'order.created' }))],
  handler: async ({ data }, { logger }) => {
    logger.info('new order', data);
  },
};
```

Each operator receives the full observable payload: for routes it is `{ req, res, ctx }`; for events it is `{ data, run, traceContext }`. Operators should return the stream—`rxpress` subscribes after your pipeline finishes. Leave `pipes` undefined if you do not need additional RxJS behaviour.

### Reactive state watchers

Need a global signal when in-memory state mutates? Pair `rxpress.state` with `rxpress.watch` to derive changes and run handlers without hand-wiring `Subject`s. Watchers share the same context helpers (`emit`, `kv`, `logger`), automatically receive a run scope (or respect the one you provide), and execute inside an OpenTelemetry span for correlation. See [`docs/reactive.md`](./reactive.md) for guidance on propagating run scopes, building operator pipelines, and applying telemetry links.

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
