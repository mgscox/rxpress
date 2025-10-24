# rxpress Monorepo

This repository hosts the `rxpress` runtime library together with a reference application that demonstrates how to assemble event-driven HTTP APIs, static assets, websockets, cron jobs, and Next.js pages under a single Express server. The workspace is managed with npm workspaces + Lerna and ships its own linting, testing, and observability stack.

---

Very much a Beta / Concept - do NOT use for production (yet)!

`rxpress` can be packaged, but is not yet pushed to NPM

---

## Packages

| Package                                                  | Description                                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`packages/rxpress`](./packages/rxpress)                 | Published npm module that exposes the `rxpress` orchestration API, helper adapters, and TypeScript definitions.                                        |
| [`packages/examples/server`](./packages/examples/server) | Example host that consumes the library, wires in logger/KV adapters, demonstrates routing patterns, and streams telemetry to OpenTelemetry collectors. |

## Getting Started

Install the library in your application:

```bash
npm install rxpress
```

Create your entry point:

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
    handler: async (payload, { logger }) => logger.info('Health audit', payload as object),
  },
];

rxpress.init({
  config: { port: 3000, loadEnv: true },
  logger: createSimpleLogger(),
  kv: createMemoryKv('example-app'),
});

rxpress.addHandlers(routes);
rxpress.addEvents(events);
await rxpress.start({ port: 3000 });
```

Optionally publish an OpenAPI spec alongside your routes:

```ts
rxpress.init({
  config: {
    port: 3000,
    documentation: {
      enabled: true,
      version: '1.0.0',
      path: '/openapi.json',
    },
  },
  logger: createSimpleLogger(),
  kv: createMemoryKv('example-app'),
});
```

Comprehensive usage guides (routing, events, cron, observability, Next.js integration, static asset serving, and adapter patterns) live under [`packages/rxpress/docs`](./packages/rxpress/docs).

## Observability & Tooling

- **OpenTelemetry**: metrics, histograms, and traces are emitted through the collector configuration in [`otel/collector-config.yaml`](./otel/collector-config.yaml).
- **Grafana & Prometheus**: bring up the docker compose stack to inspect dashboards and Jaeger traces.
- **Semantic Release**: publishing is automated via `npm run release`.

## Local development

```bash
git clone https://github.com/mgscox/newintel.git
cd newintel
npm install

# run the example server (listens on PORT from .env or 3002)
npx nx run server:dev

# in another shell hit the health endpoint
curl http://localhost:3002/api/v1/example
```

### Common Development Tasks

```bash
# compile both packages
npm run build

# run the rxpress test suite
npm test --workspace rxpress

# lint all sources
npm run lint

# auto-fix lint (all sources)
npm run lint:fix

# start the observability stack (Jaeger + Prometheus + Grafana + SwaggerUI)
docker compose -f docker/docker-compose.yml up -d
```
