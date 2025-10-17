# rxpress

Reactive orchestration layer that pairs Express with RxJS to manage HTTP routes, static assets, events, cron jobs, WebSockets, SSE streams, and optional Next.js pages in one place. The library focuses on wiring, observability, and lifecycle management so you can focus on business logic.

- 🚀 **Event-first architecture** – every handler receives an emitter, making side-effects simple and testable.
- 🧭 **Declarative routing** – JSON APIs, HTML routes, static files, SSE, and cron jobs all share the same configuration model.
- 🔌 **Bring-your-own adapters** – plug in any logger or key/value store (Redis, DynamoDB, in-memory, …).
- 🔐 **Secure bridge** – configure TLS/mTLS, proactive health checks, and simple discovery refresh in one place.
- 🍪 **Stateless sessions** – opt into encrypted cookie sessions without persisting state server-side.
- 📈 **Observability included** – OpenTelemetry metrics + traces ready for Prometheus, Jaeger, or Tempo.
- 🌉 **Polyglot via gRPC** – execute routes and events in other languages without leaving the Rxpress API.
- ⚡ **Next.js ready** – serve pages and APIs from one process without extra glue code.

## Installation

```bash
npm install rxpress
```

## Quick Start

```ts
import { rxpress } from 'rxpress';
import type { RPCConfig, EventConfig } from 'rxpress';
import { createSimpleLogger } from './adapters/simple-logger.js';
import { createMemoryKv } from './adapters/memory-kv.js';

const routes: RPCConfig[] = [
  {
    type: 'api',
    method: 'GET',
    path: '/health',
    handler: async (_req, { emit }) => {
      emit({ topic: 'audit::health', data: { at: Date.now() } });
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
  },
  logger: createSimpleLogger(),
  kv: createMemoryKv('starter'),
});

rxpress.addHandlers(routes);
rxpress.addEvents(events);
rxpress.start().catch(console.error);
```

Optional middleware such as Helmet, cookie-based sessions, compression, or CORS can be wired in with `rxpress.use(...)`; the [Getting Started guide](./docs/getting-started.md) shows both global and per-route patterns alongside the example server in `packages/server/src/main.ts`.

## Documentation

| Topic                                          | Summary                                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| [Getting Started](./docs/getting-started.md)   | Installation, adapters, bootstrapping, and auto-discovery patterns.               |
| [Routing](./docs/routing.md)                   | API/HTTP routes, static files, SSE, cron jobs, and Next.js integration.           |
| [Events](./docs/events.md)                     | Emitting and subscribing to domain events with shared context.                    |
| [Reactive State](./docs/reactive.md)           | Mutate shared state, react with RxJS operators, and propagate run/span context.   |
| [Cron](./docs/cron.md)                         | Scheduling background jobs, retries, and graceful shutdown.                       |
| [gRPC handlers](./docs/grpc.md)                | Running routes/events over gRPC, multi-target registries, TLS, and health checks. |
| [Route Documentation](./docs/documentation.md) | Generating OpenAPI specifications from routes and Zod schemas.                    |
| [Adapters](./docs/adapters.md)                 | Building logger/KV adapters and reusing the helper implementations.               |
| [Realtime](./docs/realtime.md)                 | WebSockets and server-sent events.                                                |
| [Next.js](./docs/nextjs.md)                    | Serving Next apps alongside RPC routes, custom hooks, and testing strategies.     |
| [Observability](./docs/observability.md)       | OpenTelemtry Metrics, tracing, and the exmple local Grafana/Jaeger stack.         |

## Example Project

The repository ships an opinionated example server under [`packages/server`](../server). It demonstrates:

- Programmatic registration + auto-discovery of routes
- Static asset delivery
- OpenTelemetry configuration flowing into Prometheus/Grafana/Jaeger
- Graceful shutdown hooks

Run it locally with:

```bash
npm install
npx nx run server:dev
```

## Testing

`rxpress` uses dependency injection for adapters, making it easy to supply in-memory doubles during tests. The integration tests in [`__tests__`](./__tests__) show how to spin up a server on an ephemeral port, hit endpoints with `fetch`, and assert emitted events.

## Contributing

We'd love your help! Follow [CONTRIBUTING](CONTRIBUTING.md) guide to report issues or submit a proposal.

## License

ISC © Matt Cox
