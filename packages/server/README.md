# Example Server (@newintel/server)

This package hosts the reference application used throughout the `rxpress` repository. It demonstrates how consumers can wire the library into a real HTTP server, expose APIs, serve static assets, visualise the topology, and push telemetry to the bundled observability stack.

## Highlights

- **Declarative routing** – Routes live in `src/handlers/*.handler.ts` and rely on the same `RPCConfig` objects that library users export. The sample includes JSON APIs, a static HTML page (`/graphviz`), and the workbench endpoint (`/topology.dot`).
- **Events & cron jobs** – Event handlers under `src/events/*.event.ts` receive typed payloads (`zod` schemas) and emit follow-up messages. Cron definitions follow the same pattern and appear in topology output.
- **Adapters** – The server imports helper logger/KV adapters from `rxpress/src/helpers` to show how production code can plug in real infrastructure.
- **Observability** – OpenTelemetry metrics/traces are enabled by default and feed the docker-compose stack (`docker/docker-compose.yml`) to surface Grafana dashboards and Jaeger traces.
- **Topology workbench** – `/graphviz` renders the current route/event graph in the browser (via Viz.js), while `/topology.dot` returns a Graphviz DOT file suitable for custom tooling.

## Running locally

```bash
npm install
npx nx run server:dev
```

The dev command watches TypeScript sources, reloads on change, and listens on the port defined in `PORT` (defaults to `3002`). With the server running:

- `http://localhost:3002/api/v1/example` – JSON API that emits sample events.
- `http://localhost:3002/graphviz` – Graph view of routes, events, and cron jobs (optional `?src=` param for custom DOT URLs).
- `http://localhost:3002/topology.dot` – Raw DOT document for piping into Graphviz.
- `http://localhost:3002/openapi.json` – OpenAPI spec if `documentation.enabled` is true.

## Configuration references

Runtime configuration is centred in `src/main.ts`. Key sections to review:

- `rxpress.init({ config: { ... } })` – enables metrics, workbench endpoint, and session middleware.
- `routes` array – shows API/HTTP routes, including the static HTML handler.
- `inlineEvent` and `src/events/*.event.ts` – illustrate strict schema validation and event fan-out.
- Calls to `rxpress.load({ eventDir })` and `rxpress.addHandlers(routes)` – mixing auto-discovery with inline definitions.

## Related tooling

- `packages/rxpress/docs/getting-started.md` – library bootstrap guide that mirrors the adapter setup here.
- `docker/docker-compose.yml` – observability stack wired to this example server’s OTLP endpoints.
- `packages/rxpress/__tests__` – integration tests that exercise the same handlers used by the sample app.

Use this server as a blueprint when integrating `rxpress` into your own projects: copy the adapter setup, extend the event graph, and swap in your telemetry/logging backends as needed.
