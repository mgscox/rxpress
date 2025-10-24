# rxpress-bridge-go

`rxpress-bridge-go` is ab `rxpress` bridge helper, allowing handlers to be implemented in _Go_. It wires a
gRPC `Invoker` server that forwards handler calls into your Go code while keeping the
control plane (logging, event emit, KV access) connected to `rxpress`.

## Quick start

```bash
# from packages/rxpress-bridge-go
BRIDGE_BIND=127.0.0.1:52065 \
CONTROL_TARGET=127.0.0.1:52070 \
go run ./cmd/sentiment
```

The sample under `cmd/sentiment` registers a `sentiment.analyse` handler using the
exported `bridge.Serve` helper.

```go
app, err := bridge.Serve(ctx, bind, controlTarget, map[string]bridge.Handler{
    "sentiment.analyse": analyse,
}, nil)
if err != nil {
    log.Fatal(err)
}
log.Printf("bridge listening on %s", bind)
app.Wait()
```

## API

| Function                  | Purpose                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `bridge.Serve`            | Start the Invoker server + control-plane client.           |
| `bridge.Handler`          | Signature for Go handlers (`func(ctx, method, input, …)`). |
| `(*bridge.Context).Log`   | Proxy logs back to rxpress.                                |
| `(*bridge.Context).Emit`  | Publish events through rxpress.                            |
| `(*bridge.Context).KVGet` | Read from rxpress KV buckets.                              |
| `(*bridge.Context).KVPut` | Write to rxpress KV.                                       |
| `(*bridge.Context).KVDel` | Delete KV entries.                                         |

### Serve parameters

- `bind` — address the Go process should listen on (e.g. `127.0.0.1:52065`). This is
  what rxpress connects to when invoking handlers.
- `controlTarget` — the address where rxpress exposes the control plane (matches
  `config.grpc.bind` in `rxpress.init`). The Go helper dials this endpoint to stream
  logs, emit events, and use KV.
- `handlers` — map of handler names (`sentiment.analyse`) to your Go functions.
- `options` — optional gRPC server options (TLS, interceptors, etc.).

`bridge.Serve` returns an `App` with `Wait()` and `Stop()` helpers so you can manage
lifecycle or embed the bridge inside a larger program.

## Value codec

Values are automatically converted between Go types and the `handler_bridge.proto`
`Value` message:

- `string`, `bool`, `int/*`, `float/*`, `[]byte` map to native fields.
- Structs, maps, and slices are JSON-encoded.
- `nil` becomes JSON `"null"`.

If encoding fails, the helper falls back to stringifying the value.

## Building your own bridge

1. Generate Go stubs from `proto/handler_bridge.proto` (`protoc --go_out` +
   `--go-grpc_out`). The repo includes pre-generated files under `internal/pb`.
2. Implement your handlers using the `bridge.Handler` signature.
3. Call `bridge.Serve` in `main()`.
4. Keep the rxpress app running with `config.grpc.bind` matching the bridge's
   `CONTROL_TARGET`.
