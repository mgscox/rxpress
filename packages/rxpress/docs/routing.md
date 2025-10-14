# Routing

`rxpress` routes are declared through `RPCConfig` objects. Each handler receives the original Express `Request`, a rich context (`emit`, `kv`, `logger`, optional SSE stream), and returns an `RPCHttpResult`/`RPCApiResult`.

## Route Types

| Type   | Description                                                                                 |
| ------ | ------------------------------------------------------------------------------------------- |
| `api`  | JSON APIs. Responses are automatically serialized with `res.json(...)`.                     |
| `http` | Return raw strings, HTML, or buffers. Use the `mime` property to override `Content-Type`.   |
| `sse`  | Server-sent events. Handlers interact with the `stream` helper instead of returning values. |
| `cron` | Declarative cron jobs that run via the built-in scheduler.                                  |

Each route can specify middleware, request/response schemas (Zod), and emitted events.

```ts
const getUser: RPCConfig = {
  type: 'api',
  method: 'GET',
  path: '/api/users/:id',
  queryParams: z.array(z.string()),
  responseSchema: z.object({ id: z.string(), name: z.string() }),
  handler: async (req) => {
    const user = await loadUser(req.params.id);
    return { status: 200, body: user };
  },
};
```

## Static Files

`rxpress` can serve static assets without writing custom logic. Supply a `staticRoute` block with a `filename` and optional `SendFileOptions`. The route-level `options.root` overrides the server-level `staticRoutDir` configured during `rxpress.init`.

```ts
rxpress.init({
  config: {
    staticRoutDir: new URL('../public', import.meta.url).pathname,
    port: 3000,
  },
  logger,
  kv,
});

rxpress.addHandlers([
  {
    type: 'http',
    method: 'GET',
    path: '/assets/logo',
    staticRoute: {
      filename: 'logo.svg',
    },
  },
  {
    type: 'http',
    method: 'GET',
    path: '/assets/reports',
    staticRoute: {
      filename: 'daily.csv',
      options: { root: '/mnt/reports' },
    },
  },
]);
```

If a file cannot be found Express returns a 404 and `rxpress` sends a consistent error payload (`{"error":"Resource not found"}` for API routes, plain text otherwise).

### Single-Page Applications (Angular, React, Vue, …)

Because static routes use Express’ `sendFile` under the hood, you can serve compiled SPA assets (Angular CLI, Vite, Create React App, etc.) without additional middleware. Point `staticRoutDir` at your build output and add a catch-all route that returns the framework’s `index.html`.

```ts
rxpress.init({
  config: {
    staticRoutDir: new URL('../dist/angular-app', import.meta.url).pathname,
  },
  logger,
  kv,
});

rxpress.addHandlers([
  // API routes go here
  {
    type: 'http',
    method: 'GET',
    path: '/app/*',
    staticRoute: { filename: 'index.html' },
  },
]);
```

This setup plays well with client-side routers: Angular/React/Vue handle deep links client-side, while API routes and other RPC handlers continue to run on the same Express instance. If you later adopt Next.js for server rendering, you can enable the optional `next` integration without changing your static routes.

## gRPC handlers

Set `kind: 'grpc'` to forward a route through the gRPC bridge. Request data is serialised (body, query, params, headers, authenticated user) and delivered to your gRPC handler, which responds with status/headers/body metadata.

```ts
rxpress.addHandlers({
  type: 'api',
  method: 'POST',
  path: '/payments',
  emits: ['payments.authorised'],
  kind: 'grpc',
  grpc: {
    handlerName: 'payments-handler',
    service: 'payments-service',
    timeoutMs: 3_000,
  },
});
```

Remote handlers can call `ctx.emit`, `ctx.kv`, `ctx.log`, and interact with the current run scope just like local handlers. See [`gPRC`](./grpc.md) for handler implementation patterns, multi-language guidance, and auto-discovery.

## Documenting Routes

Enable the documentation generator to publish an OpenAPI specification for every `api`/`http` route. See [API Documentation](./documentation.md) for details.

## Server-Sent Events

Declare SSE routes with `type: 'sse'`. The handler receives a `stream` helper for sending data and signalling errors. Payloads stream as raw chunks by default, so clients can iterate the response body without decoding SSE frames. Attach a `responseSchema` (for example a `z.object`) to validate each message and have `rxpress` emit newline-delimited JSON that consumers can `JSON.parse`. Opt into classic `event:` framing by setting `streamFormat: 'event'`.

```ts
const sseRoute: RPCConfig = {
  type: 'sse',
  method: 'GET',
  path: '/stream/logs',
  handler: async (_req, { stream, emit }) => {
    stream?.send({ message: 'connected' });
    emit({ topic: 'audit::sse-connected', data: { at: Date.now() } });
  },
};
```

For further details, refer to [Realtime](./realtime.md) documentation.

## Next.js Integration

Routes that are not handled by your RPC definitions can be delegated to Next.js by supplying the `next` block during `init`.

```ts
rxpress.init({
  config: {
    port: 3000,
    next: {
      dir: new URL('../apps/web', import.meta.url).pathname,
      dev: process.env.NODE_ENV !== 'production',
      basePath: '*',
    },
  },
  logger,
  kv,
});
```

`rxpress` boots Next.js lazily, wires the handler into the Express app, and ensures the Next server closes when you call `rxpress.stop()`.

## Auto-Discovery

`rxpress.load` walks directories and dynamically imports files that end with:

- `*.handler.js` → routes (`RPCConfig` exports)
- `*.event.js` → event handlers (`EventConfig` exports)
- `*.cron.js` → cron definitions

This enables feature-based folder structures while keeping runtime registration succinct.

**NOTE 1**: If you are using Typescript, simply load the files from the appropriate build output folder, rather than the source folder.
