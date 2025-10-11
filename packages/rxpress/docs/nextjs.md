# Next.js Integration

`rxpress` can host a Next.js application alongside your RPC routes. Enable it by supplying a `next` configuration block when initialising the server.

```ts
rxpress.init({
  config: {
    port: Number(process.env.PORT ?? 3000),
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

## How It Works

1. The `NextService` lazily imports the `next` package the first time you call `rxpress.start`.
2. `next.prepare()` runs before the HTTP server begins listening.
3. `getRequestHandler()` is registered as a catch-all route (or on `basePath` if supplied).
4. `rxpress.stop()` calls `app.close()` so Next.js can drain pending requests.

## Customising the Integration

- **`basePath`**: mount Next.js under a specific prefix (e.g. `/app`), leaving other routes to behave normally.
- **`hostname` / `port`**: supply explicit values if Next.js needs to know about proxies or non-default ports.
- **`onReady`**: run custom logic after preparation. For example, you can add incremental adoption routes or reuse the Next handler manually.

```ts
next: {
  onReady: async ({ app, handler }) => {
    app.get('/marketing/:slug', (req, res, next) => {
      handler(req, res).catch(next);
    });
  },
},
```

## Testing

The `next.factory` hook lets you inject a test double. See [`rxpress.next.test.ts`](../__tests__/rxpress.next.test.ts) for an in-memory implementation that verifies the integration without installing the real `next` package.

```ts
next: {
  factory: () => ({
    async prepare() {},
    async close() {},
    getRequestHandler: () => async (req, res) => {
      res.end('stub');
    },
  }),
},
```

## Static Assets

Combine Next.js with the static routing features to keep legacy assets and new pages under the same host. The library handles precedence so that explicit RPC/static routes win before delegating to Next.
