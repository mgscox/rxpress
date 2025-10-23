# rxpress-bridge (Python)

`rxpress-bridge` lets you implement rxpress route/event handlers in Python without re-writing the
bridge plumbing yourself. Under the hood it speaks the same `handler_bridge.proto` that rxpress uses
for TypeScript gRPC handlers, so `ctx.emit`, `ctx.log`, `ctx.kv`, run metadata, and tracing IDs all
behave exactly like they do in in-process handlers.

> **Status:** Early preview. Core request/response flow is working (see the multi-language sentiment
> example), but the API is still stabilising. Check [`TODO.md`](./TODO.md) for remaining work (decorator API, richer retries, unit tests).

## When you’d use this

- You already have business logic or ML models in Python but want to keep HTTP/event orchestration in
  rxpress.
- You like the rxpress programming model (`ctx.emit`, `ctx.kv`, run scopes) and want those features in
  your Python handlers without re-implementing the bridge.
- You plan to port the same handlers later to another language—Python is just the starting point.

## Planned anatomy

```
rxpress-bridge-python/
├── proto/handler_bridge.proto     # copied from packages/rxpress/src/grpc
├── src/rxpress_bridge/
│   ├── __init__.py
│   ├── control.py                 # client for ControlPlane.Connect
│   ├── server.py                  # Invoker service + handler registry
│   ├── context.py                 # exposes log/emit/kv helpers to user handlers
│   └── value_codec.py             # encode/decode helper matching rxpress encodeValue/decodeValue
└── tests/
    └── ... (integration fixtures vs rxpress example)
```

## How it works with rxpress

1. In rxpress you configure a route/event with `kind: 'grpc'` and point `handlerName` to your Python
   handler.
2. `rxpress-bridge` hosts the gRPC `Invoker` service and keeps a duplex connection open to the
   rxpress control plane.
3. When rxpress invokes your handler, the bridge passes the payload + metadata to your Python function
   and gives you a `BridgeContext` with familiar helpers (`ctx.log`, `ctx.emit`, `ctx.kv.*`).
4. You return a dict describing the HTTP response (status, headers, body) and the bridge sends it back
   to rxpress.

Because both sides follow the same protocol, you can mix and match languages: a Go or Rust helper just
needs to implement `handler_bridge.proto` the same way.

## Quick usage sketch

```python
from rxpress_bridge import serve

async def analyse(method, payload, meta, ctx):
    text = (payload.get('body') or {}).get('text', '')
    ctx.log('info', 'scoring text', {'length': len(text)})
    return {
        'status': 200,
        'body': {
            'text': text,
            'polarity': 0.0,
        },
    }

app = serve(
    bind='127.0.0.1:50055',
    handlers={'sentiment.analyse': analyse},
    control_target='127.0.0.1:50070',
)

try:
    app.wait_forever()
finally:
    app.stop(grace=1.0)
```

TypeScript routes reference the handler with `kind: 'grpc'`:

```ts
rxpress.addHandlers({
  type: 'api',
  method: 'POST',
  path: '/api/sentiment',
  kind: 'grpc',
  grpc: {
    handlerName: 'sentiment.analyse',
    service: 'python-sentiment',
  },
});
```

### Parameter overview

| Parameter        | Where it’s used      | Purpose                                                                                                                                      |
| ---------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `bind`           | `serve(...)`         | Address where the Python process exposes the `Invoker` service (rxpress calls this).                                                         |
| `control_target` | `serve(...)`         | Address where rxpress exposes its control plane (`config.grpc.bind`/`target`). The bridge dials this to send logs, emits, and KV operations. |
| `handlers`       | `serve(...)`         | Mapping of handler names (`handlerName` in rxpress config) to Python callables.                                                              |
| `service` (TS)   | rxpress route config | Looks up a registry entry (`config.grpc.registry`) to reuse connection settings across handlers.                                             |

Common patterns:

- **Separate ports (recommended locally):** bind rxpress to `127.0.0.1:50070`, start the Python
  helper on `127.0.0.1:50055`, set `control_target` to `127.0.0.1:50070`. Requests flow into Python,
  control messages flow back to rxpress.
- **Single remote bridge:** point rxpress at a remote orchestrator (e.g. `grpc.target = bridge:50070`).
  Set `control_target` to that address; `bind` can remain local or remote depending on where the
  Python service is hosted.

`bind` and `control_target` may match if rxpress also proxies inbound invocations (e.g. only remote
bridges exist). When they differ, remember: `bind` is where _rxpress_ calls you; `control_target` is
where _you_ call rxpress for logging, emits, and KV.
