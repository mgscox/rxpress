# Reactive State

`rxpress` ships a lightweight reactive store so you can synchronise derived work without hand-wiring RxJS subjects. It is ideal for cross-cutting concerns such as audit trails, cache invalidation, or background tasks that should respond whenever your application mutates shared state.

## Defining state

Create a reactive object with `rxpress.state(initialValue)`. The object behaves like a normal JavaScript object – read and write props directly, create nested objects, or delete keys. Mutations are batched per microtask, so multiple updates inside the same tick only trigger one notification.

```ts
import { rxpress } from 'rxpress';

const session = rxpress.state({ active: 0, latestUserId: undefined as string | undefined });
```

## Watching for changes

Attach watchers with `rxpress.watch`. Supply an optional `select` function to derive the value you care about and a `handler` that runs whenever the selection changes. The handler receives the current value, the previous value (if any), the root object, and a rich context matching other `rxpress` handlers.

## Example Reactive Handler

The snippet below demonstrates bridging a request-scoped `RunContext` into the watcher. We store the current run while the route handler executes, then look it up inside the watcher’s `ctx` factory. This keeps the connection between the originating request and the later reactive update, allowing KV writes and telemetry to stay correlated. You can replace `AsyncLocalStorage` with any context mechanism that fits your runtime; if you skip it entirely, `rxpress` will create a fresh run per emission automatically.

```ts
// Capture per-request run scopes so the watcher can access them later.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RPCConfig, RunContext } from 'rxpress';

const activeRun = new AsyncLocalStorage<RunContext>();

const subscription = rxpress.watch(session, {
  select: (root) => root.active,
  ctx: () => ({
    // Optional: supply the active request's run; rxpress will create a new one if this is undefined.
    run: activeRun.getStore(),
  }),
  handler: async (next, prev, _root, ctx) => {
    ctx.logger.info('active session count changed', {
      next,
      prev,
      span: ctx.span?.spanContext().traceId,
    });
    ctx.emit({ topic: 'sessions::updated', data: { active: next } });
  },
});

const routes: RPCConfig[] = [
  {
    type: 'api',
    method: 'POST',
    path: '/sign-in',
    handler: async (_req, ctx) => {
      const run = ctx.run;

      if (run) {
        await activeRun.run(run, async () => {
          session.active += 1;
          session.latestUserId = run.id;
        });
      } else {
        session.active += 1;
      }

      return { status: 204, body: {} };
    },
  },
];
```

The context exposes:

- `emit` – publish events with run/span correlation data.
- `kv` / `kvPath` – reuse your configured key/value adapter.
- `logger` – the same logger instance provided to `rxpress.init`.
- `run` – run-scoped storage (automatically created when absent). Capture an existing scope with `AsyncLocalStorage` or a similar utility if you need to continue a specific request.
- `span` – automatically-created OpenTelemetry span that wraps each handler invocation.

Provide a function for `ctx` when you need fresh values per emission (for example, a per-request run scope). Pass a plain object when the context is static.

## Configuration options

`rxpress.watch(state, config)` accepts the following fields:

- `name?: string` / `description?: string` – metadata for logging and the topology workbench.
- `emits?: string[]` – declare the topics this watcher emits so validation/topology visuals can map dependencies.
- `select?: (root) => value` – derive a subset of the state to observe. Defaults to the entire object (`root`).
- `filter?: (next, prev) => boolean` – decide whether a change should trigger the handler. Defaults to a shallow equality check on the selected value.
- `pipes?: OperatorFunction[]` – RxJS operators that manipulate the stream before it reaches your handler. Useful for throttling, buffering, or metrics.
- `strategy?: 'merge' | 'concat' | 'switch' | 'exhaust'` – controls concurrency when the handler returns a promise. Defaults to `'merge'`.
- `ctx?: () => Partial<Context>` or object – supply additional context (`emit`, `kv`, `logger`, `run`, `kvPath`). If you omit `run`, `rxpress` creates a short-lived scope automatically; providing `run` lets you continue a request-specific scope captured elsewhere.

All other context fields (`emit`, `kv`, `kvPath`, `logger`, `span`) are provided automatically by the runtime so reactive handlers behave like routes, events, and cron jobs.

#### Strategy cheat sheet

Reactive handlers are processed through a microticks interface, which ensures that multiple changes to a variable within a single synchronous event loop result in only a one call to the handler with the final value. However, given the nature of asynchronous code, it cannot be guaranteed the handler will be invoked immediately so queing management options are provided:

| Strategy  | Behaviour                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `merge`   | Fire every change immediately, even if previous handler calls are still running. Useful when work is independent.                                                  |
| `concat`  | Queue changes and process them one at a time in arrival order. Guarantees sequential execution.                                                                    |
| `switch`  | Cancel the in-flight handler when a new change arrives, then run only the latest one. Ideal for “latest value wins” scenarios.                                     |
| `exhaust` | Ignore new changes while a handler is running; the first change wins until the handler resolves. Helpful when work is expensive and you prefer to drop duplicates. |

### Run Context

Run Context is an ephemeral key/value store that exists only for the current run across the handler and any `emits` it makes. This is created automatically, or can be optionally provided. This example uses `AsyncLocalStorage`.

- **AsyncLocalStorage** captures the `RunContext` created in the route handler, even though the watcher executes outside the original call stack. Without it, `rxpress.watch` would have no way to know which request triggered the state change.
- **`ctx.run`** inside the watcher retrieves that stored context so you can read/write run-scoped KV data or emit correlated events. If no request is active, `rxpress` automatically creates a short-lived run for the emission, so `ctx.run` is populated either way.
- **`name`** doubles as the span label (`reactive ${name}`) and the identifier used by the topology workbench.
- You can swap in any mechanism you like (for example, a custom context manager). The key idea is to supply a `run` object when mutating the state and retrieve it inside the watcher via the `ctx` factory.

## Removing Watchers

Call `unsubscribe()` on the subscription returned by `rxpress.watch` when you no longer need the watcher.

## Adding RxJS operators

Watchers accept a `pipes` array so you can compose RxJS operators prior to your handler. Each operator receives a `ReactiveEmission` object `{ next, prev, root, ctx }` and must return the same shape. This makes it easy to debounce, throttle, or gate changes.

```ts
import { tap, filter } from 'rxjs/operators';

rxpress.watch(session, {
  select: (root) => root.active,
  pipes: [
    tap(({ next, ctx }) => ctx.logger.debug('session candidate', { value: next })),
    filter(({ next }) => next > 0),
  ],
  handler: async (next) => {
    await notifyDashboard(next);
  },
});
```

Because updates are batched per microtask, insert an `await` (or `setTimeout(..., 0)`) between rapid mutations if you need intermediate values to fire separately.

## Telemetry & validation

Reactive handlers integrate with your existing observability pipeline. Each invocation automatically runs inside an OpenTelemetry span (`ctx.span`), so emitted events and downstream cron/route work retain correlation data for Grafana, Jaeger, or Tempo.

If you need to validate or transform payloads before the handler runs, use the `pipes` hook with Zod, custom operators, or inline logic. Reactive handlers can emit events, schedule crons, and write to the KV store just like RPC routes and event subscribers, so ensure subscribers exist for any topics you publish.

When you supply `name`, `description`, and `emits`, the topology workbench (`workbench.path`) renders reactive watchers alongside routes, events, and crons so you can visualise their dependencies.

## Clean shutdown

When you call `rxpress.stop()` the library tears down any active watchers that were registered through `rxpress.watch`. Always unsubscribe long-lived watchers first if they manage resources (for example, open file descriptors) so that shutdown remains predictable.
