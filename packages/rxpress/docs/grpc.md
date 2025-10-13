# gRPC Handlers

`rxpress` can execute route and event handlers over [gRPC](https://grpc.io/docs/what-is-grpc/introduction/) so you can keep your HTTP/event orchestration in Node.js while writing business logic in TypeScript _or_ any other language that speaks gRPC. The gRPC implementations can reside on any accessible server, including connections over the Web. This provides an easy way to mix-and-match implementation languages. Since we use gROC, you can use any language which supports gRPC (Python, Go, Rust, C#, etc.). `rxpress` reuses a single protobuf as a bridge (`handler_bridge.proto`) to move requests, responses, logs, events, and KV operations between the runtime and your handlers.

## Enabling the bridge

Provide a `grpc` block when you call `rxpress.init`. You can bind an in-process orchestrator (helpful for local development) or point at an existing gRPC endpoint.

```ts
rxpress.init({
  config: {
    grpc: {
      bind: '127.0.0.1:0', // start an in-process orchestrator (port chosen automatically)
      localHandlers: 'handlers/**/*.ts', // optional glob for TypeScript handler modules
      target: 'grpc.example.internal:50051', // optional default when you want to talk to a remote bridge instead
      registry: {
        // optinal registry allowing handlers to specifically select a named grpc service
        'orders-service': {
          target: 'grpc.orders.internal:50052',
          metadata: { 'x-service': 'orders' },
        },
        'billing-service': {
          target: 'grpc.billing.internal:50053',
          timeoutMs: 10_000,
        },
      },
    },
    // ...other config (metrics, helmet, sessions, etc.)
  },
  logger,
  kv,
});
```

When `bind` or `localHandlers` is set, `rxpress` hosts the `Invoker` + `ControlPlane` services for you. If you only provide a `target`, the library skips starting a local server and forwards requests to the remote host.

## Defining a gRPC route handler

Add `kind: 'grpc'` to any route configuration and specify the handler name you registered with the bridge. All request data (body, query, params, headers, and authenticated user) is forwarded as JSON so remote handlers can access it easily. When handlers live on different gRPC servers, reference a `registry` entry with the optional `service` key (e.g. `service: 'orders-service'`) instead of repeating hostnames in every route.

```ts
rxpress.addHandlers({
  type: 'api',
  method: 'POST',
  path: '/orders',
  emits: ['orders.created'],
  kind: 'grpc',
  grpc: {
    handlerName: 'orders-handler',
    service: 'orders-service',
    timeoutMs: 5_000, // optional per-call timeout
    metadata: { 'x-service-version': 'beta' },
  },
});
```

Your handler receives `(method, input, meta, ctx)` and can keep using `ctx.emit`, `ctx.kv`, `ctx.log`, and `ctx.run` exactly like an in-process handler. We always include the `method` field to describe _which_ pipeline triggered the invocation (`'http'`, `'api'`, `'event'`, `'cron'`, `'sse'`). In most cases your gRPC handler will be dedicated to a single route or event and can safely ignore the value; it simply mirrors the metadata we send for local handlers so that shared implementations remain possible if you choose that architecture.

Return values map to HTTP responses: `status`, `headers`, `mime`, and `body`. If you omit `body`, the library infers it from the remaining properties.

Below is the same handler expressed in TypeScript and Python so you can compare the API implementations.

<details open>
<summary><b>TypeScript</b></summary>

```ts
export const handler = {
  name: 'orders-handler',
  async invoke(method, input, meta, ctx) {
    ctx.log('info', 'processing order', { method, tenant: meta?.tenant });

    const order = input?.body;
    await ctx.emit({ topic: 'orders.created', data: order, run: ctx.run });

    return {
      status: 202,
      headers: { 'x-orders-handler': 'grpc' },
      body: {
        accepted: true,
        runId: ctx.run?.id,
        tenant: meta?.tenant,
      },
    };
  },
};
```

</details>

<details closed>
<summary><b>Python</b></summary>

```python
class OrdersHandler:
    name = "orders-handler"

    async def invoke(self, method, input, meta, ctx):
        await ctx.log("info", "processing order", {
            "method": method,
            "tenant": meta.get("tenant") if meta else None,
        })

        order = input.get("body") if input else None
        await ctx.emit({
            "topic": "orders.created",
            "data": order,
            "run": ctx.run,
        })

        return {
            "status": 202,
            "headers": {"x-orders-handler": "grpc"},
            "body": {
                "accepted": True,
                "runId": getattr(ctx.run, "id", None),
                "tenant": meta.get("tenant") if meta else None,
            },
        }
```

</details>

## gRPC-backed events

Set `kind: 'grpc'` on an `EventConfig` to route subscriptions through the bridge. The same handler can support both HTTP and event invocations by branching on the `method` argument (`'api'`, `'http'`, `'event'`). We automatically pass the originating run scope and OpenTelemetry span context so downstream logging, KV operations, and emits keep their correlation data.

```ts
const auditEvent: EventConfig = {
  kind: 'grpc',
  subscribe: ['orders.created'],
  emits: ['audit.recorded'],
  grpc: {
    handlerName: 'orders-handler',
    service: 'billing-service',
  },
};
```

## Registry & failover

Supply multiple endpoints inside a registry entry to tolerate node failures. The bridge skips recently unhealthy endpoints (30s backoff by default) and retries the next entry when transport errors occur (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, etc.). Metadata and timeout settings merge in the order: registry → endpoint → binding.

```ts
rxpress.init({
  config: {
    grpc: {
      registry: {
        'orders-service': {
          endpoints: [
            { target: '10.0.0.10:50051', timeoutMs: 1000 },
            { target: '10.0.0.11:50051', timeoutMs: 1000 },
            {
              /* falls back to bind()/target default */
            },
          ],
        },
      },
    },
  },
  logger,
  kv,
});
```

## TLS configuration

Define TLS once at the bridge level (`config.grpc.tls`) and optionally override it per service, endpoint, or handler binding. Provide PEM file paths; mutual TLS is enabled when `certFile`/`keyFile` are supplied. Set `insecure: true` to opt out of TLS for a specific binding even when the global config enables it.

```ts
rxpress.init({
  config: {
    grpc: {
      tls: {
        caFile: new URL('./certs/root.pem', import.meta.url).pathname,
        certFile: new URL('./certs/client.pem', import.meta.url).pathname,
        keyFile: new URL('./certs/client.key', import.meta.url).pathname,
      },
      registry: {
        'orders-service': {
          tls: {
            certFile: new URL('./certs/orders.pem', import.meta.url).pathname,
            keyFile: new URL('./certs/orders.key', import.meta.url).pathname,
          },
          endpoints: [
            { target: 'orders-a.internal:50051' },
            { target: 'orders-b.internal:50051', tls: { insecure: true } },
          ],
        },
      },
    },
  },
  logger,
  kv,
});
```

## Health checks

Attach `healthCheck` to any registry entry, endpoint, or binding to enable proactive connectivity probes. The bridge calls `waitForReady` on a timer (30s by default, 5s timeout) and marks endpoints unhealthy when probes fail, removing them from the rotation until they recover.

```ts
rxpress.init({
  config: {
    grpc: {
      healthCheck: { intervalMs: 15_000, timeoutMs: 3_000 },
      registry: {
        'payments-service': {
          endpoints: [
            { target: 'payments-a:50051' },
            { target: 'payments-b:50051', healthCheck: { intervalMs: 5_000 } },
          ],
        },
      },
    },
  },
  logger,
  kv,
});
```

## Service discovery

For dynamic environments, attach a `discover` block to any registry entry. The current implementation watches JSON files on disk—ideal for CI fixtures or simple deployments. The file should export an array of targets (either strings or objects that mirror `GrpcEndpointConfig`). The watcher reloads on the configured interval and refreshes available endpoints without restarting the process.

```ts
rxpress.init({
  config: {
    grpc: {
      registry: {
        'search-service': {
          discover: {
            type: 'file',
            path: new URL('./discovery/search.json', import.meta.url).pathname,
            intervalMs: 5_000,
          },
        },
      },
    },
  },
  logger,
  kv,
});
```

> Note: file-based discovery is a stepping stone. The TODO list tracks future adapters for DNS/service registry sources so larger fleets can plug in their own control plane.

## Remote languages

Any language with a first-class gRPC implementation can host handlers. Implement the same `handler_bridge.proto` contract (shipped in `dist/grpc/handler_bridge.proto`) and:

1. Register with the `ControlPlane.Connect` stream to receive a shared context (`log`, `emit`, `kv`).
2. Serve an `Invoker.Invoke` RPC that executes your handler code.
3. Use the shared run ID (`meta.run_id`) and OpenTelemetry identifiers (`meta.trace_id`, `meta.span_id`) to participate in tracing/metrics.

If you prefer a ready-made reference, model your implementation on the `handler_bridge.proto` contract: expose an `Invoker` service that executes handlers and keep a duplex `ControlPlane` stream for `log`, `emit`, and `kv` calls. The original repository starter followed this exact pattern and can be recreated in any language runtime.

## Error handling and retries

- gRPC status codes are translated back into `Error` objects. A non-zero status code will surface as a 500-level response for HTTP routes or an error log for events.
- Timeouts and metadata can be configured per binding with `timeoutMs` and `metadata` fields.
- The bridge automatically cleans up run-scoped KV entries after the handler and any downstream events finish executing.

## Next steps

- Implement service discovery/health checks so the bridge can target multiple remote handler hosts.
- Add mTLS to secure traffic between the Node.js orchestrator and remote language runtimes.
- Extend your handlers with streaming RPCs when you need long-lived bidirectional workflows.
