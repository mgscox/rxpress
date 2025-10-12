# Observability

`rxpress` emits metrics and traces via OpenTelemetry. Instrumentation is configured through the `metrics` block supplied to `rxpress.init`.

## Metrics

Metrics are exported over OTLP HTTP by default (`http://localhost:4318/v1/metrics`). Adjust the endpoint with `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`.

```ts
rxpress.init({
  config: {
    metrics: {
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
      console_log: { level: DiagLogLevel.INFO },
    },
  },
  logger,
  kv,
});
```

The library reports:

- `rxpress_server_requests_total`
- `rxpress_server_request_duration_ms`
- `rxpress_server_request_latency_ms`

Use the included `docker-compose.yml` at the repo root to start a Prometheus + Grafana stack with dashboards pre-provisioned.

## Tracing

Traces forward to the OTLP HTTP endpoint at `http://localhost:4318/v1/traces` unless you override `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`. They are compatible with Jaeger, Tempo, and other OTLP receivers.

```ts
metrics: {
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://collector:4318/v1/metrics',
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://collector:4318/v1/traces',
}
```

Example spans include route names (e.g. `GET /api/v1/example`) and status codes. When routes emit events, the handler spans link back to the originating request via OpenTelemetry span links, giving backends such as Jaeger or Tempo enough context to render a dependency graph from HTTP → events → cron jobs.

## Logging Integration

Logs produced by your adapter can include correlation IDs and timestamps from the request context. Combine logs + traces in Grafana/Jaeger to debug latency spikes or errors.

## Local Collector Stack and UI

The repository includes an example stack (`./docker/docker-compose.yml`) that wires everything together:

- **otel-collector** – receives OTLP signals on `4317` (gRPC) / `4318` (HTTP), exports metrics to Prometheus and traces to Jaeger.
- **prometheus** – scrapes the collector at `otel-collector:8889`.
- **grafana** – pre-provisioned with the example dashboard `rxpress Observability` and wired into Prometheus and Jaeger.
- **jaeger** – exposes the trace UI at `http://localhost:16686`.
- **swagger-ui** – renders your OpenAPI document (default URL: `http://localhost:8081/?url=http://localhost:3002/openapi.json`). Override the JSON location with `SWAGGER_UI_URL` or set `URL` in the compose file.

Copy, or clone, the docker folder and bring the stack up with:

```bash
docker compose up -d
open http://localhost:3000   # Grafana dashboard
open http://localhost:16686  # Jaeger UI
```

The compose file is illustrative—you can adapt the collector configuration (`otel/collector-config.yaml`) to match your own infrastructure, or replace components if you already operate a telemetry platform.

## Topology Workbench

Set the optional `workbench.path` configuration to expose a Graphviz DOT representation of the current routes, events, topics, and cron jobs:

```ts
rxpress.init({
  config: {
    workbench: { path: '/topology.dot' },
  },
  logger,
  kv,
});
```

The endpoint responds with `text/vnd.graphviz`, making it easy to feed into Graphviz, Mermaid, or any tooling that understands DOT. Edges connect emitters to topics and topics to subscribers; system events prefixed with `SYS::` are included for completeness but excluded from validation.
