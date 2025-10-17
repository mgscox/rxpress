# Adapters

`rxpress` keeps logging and key-value persistence outside the library so you can plug in whatever stack your organisation trusts. Only two adapters are required:

- **Logger** (`Logger` interface) – exposes levelled logging (`info`, `debug`, `error`, etc.) and optional listeners.
- **KV Store** (`KVBase`) – minimal set/get/del API used for sharing state between routes, events, cron jobs, and reactive watchers.

## Logger Adapter

```ts
import pino from 'pino';
import type { Logger, LogLogger } from 'rxpress';

const base = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export const logger: Logger = {
  child(meta) {
    const child = base.child(meta);
    return {
      ...logger,
      info: child.info.bind(child),
      error: child.error.bind(child),
      debug: child.debug.bind(child),
      warn: child.warn.bind(child),
      log: child.info.bind(child),
    };
  },
  info: (...args) => base.info(...args),
  error: (...args) => base.error(...args),
  debug: (...args) => base.debug(...args),
  warn: (...args) => base.warn(...args),
  log: (payload) => base.info(payload),
  addListener(_cb: LogLogger) {
    // hook for forwarding entries to another sink
  },
};
```

## Key-Value Adapter

```ts
import type { KVBase } from 'rxpress';

export const kv: KVBase = {
  set: (key, value) => redisClient.set(key, JSON.stringify(value)),
  get: async (key) => {
    const stored = await redisClient.get(key);
    return stored ? JSON.parse(stored) : undefined;
  },
  has: (key) => redisClient.exists(key).then(Boolean),
  del: (key) => redisClient.del(key).then(() => undefined),
};
```

Because adapters are dependency-injected, you can swap them per environment (local memory for tests, Redis or DynamoDB in production) without touching application logic.

## Helper Implementations

Reference implementations live in [`src/helpers`](../src/helpers). They are intentionally lightweight so you can copy them into your repository and customise as needed:

- `simple-logger.service.ts` – console logger with structured output
- `memory-kv.service.ts` – Map-backed KV implementation
- `winston-logger-adapter.ts`, `pino-logger-adapter.ts` – additional examples for popular logging frameworks
- `redis-kv.service.ts` – ready-to-use Redis adapter

## Testing

When writing unit tests, provide in-memory adapters and inspect the resulting state to assert behaviour. The test utilities in `packages/rxpress/__tests__` showcase this pattern.

## Run-Scoped Storage

Every request/cron/event gets a unique run identifier. Access a run-scoped store via `ctx.run`:

```ts
const route: RPCConfig = {
  type: 'api',
  method: 'GET',
  path: '/profile',
  handler: async (_req, ctx) => {
    await ctx.run.set('profile.id', ctx.run.id);
    const cached = await ctx.run.get('profile.id');
    return { status: 200, body: { id: cached } };
  },
};
```

The run store is automatically created at the beginning of the request and deleted once all downstream work (including event handlers) completes.

Use `ctx.kvPath` for dot-notation access to your persistent KV backend:

```ts
await ctx.kvPath.set('session.counter', 1);
const value = await ctx.kvPath.get<number>('session.counter');
```
