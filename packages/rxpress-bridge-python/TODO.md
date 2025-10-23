# TODO – rxpress Python bridge

- [x] **Proto stubs**
  - [x] Copy `handler_bridge.proto` into `proto/` and add a generation script.
  - [x] Generate `handler_bridge_pb2.py` and `handler_bridge_pb2_grpc.py` under
        `src/rxpress_bridge/generated/` (commit the files so users do not need protoc locally).

- [x] **Value codec**
  - [x] Port `encodeValue` / `decodeValue` helpers from the rxpress implementation to Python.
  - [ ] Unit tests covering strings, numbers, bools, bytes, dict/list, and `None`.

- [x] **Control plane client**
  - [x] Maintain a long-lived `ControlPlane.Connect` stream to the rxpress instance (target taken
        from configuration or request metadata).
  - [x] Support `log`, `emit`, `kv_get`, `kv_put`, `kv_del` messages, returning futures/promises for
        operations that expect acknowledgements.
  - [ ] Handle heartbeats and connection retries gracefully (current retry is basic).

- [x] **Handler context**
  - [x] Expose async-friendly helpers (`ctx.log`, `ctx.emit`, `ctx.kv.get/put/del`) that delegate to
        the control client and include per-invocation metadata (run ID, trace IDs).
  - [x] Provide access to the raw `meta` and `input` for advanced scenarios.

- [x] **Invoker server**
  - [x] Serve the `Invoker.Invoke` RPC, decode request payloads, and call registered handler
        callables.
  - [x] Convert handler results to the bridge response format (status, headers, mime, body, plus
        arbitrary fields).
  - [ ] Propagate structured errors back to rxpress (non-zero gRPC status with message details).

- [ ] **Developer ergonomics**
  - [ ] Decorator / registration API (`@bridge.handler('name')`) and `bridge.start()` helper.
  - [ ] Configuration object supporting insecure/TLS control targets, custom thread pool sizes, and
        graceful shutdown.
  - [ ] Logging hooks so Python-side incidents surface clearly.

- [x] **Integration demo**
  - [x] Replace the ad-hoc Python server in `packages/examples/multi-language-sentiment` with the
        new helper.
  - [x] Update the TypeScript example to use `kind: 'grpc'` bindings pointing at the helper.
  - [x] Document environment variables (bridge bind, control target, service registry entry).

- [ ] **Testing & CI**
  - [ ] Add pytest integration tests that spin up rxpress in memory and ensure `log`, `emit`, and
        `kv` operations traverse the bridge.
  - [ ] Provide a smoke test script used by CI to validate the helper against the latest rxpress
        commit.

- [ ] **Docs**
  - [ ] Expand the README with usage examples and troubleshooting tips once the helper is
        functional.
