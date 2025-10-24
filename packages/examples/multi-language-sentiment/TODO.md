# Multi-language Sentiment (TS + Python/Go gRPC) TODO

Goal: Minimal example demonstrating how an rxpress TypeScript app can call gRPC services written in other languages. Keep scope comparable to `rxpress`'s gRPC health test—just add a web/API wrapper so the interaction is easy to demo across multiple bridges.

- [x] Finalise architecture sketch in README (clarify minimal gRPC bridge + stub sentiment logic).
- [x] Proto adjustments: ensure `sentiment.proto` only includes text input and simple sentiment fields.
- [x] Python service:
  - [x] Implement `sentiment.server` running a simple gRPC server with deterministic heuristics.
  - [x] Provide CLI entry point and instructions for running it (`python -m sentiment.server`).
- [x] TypeScript side:
  - [x] Use the rxpress gRPC bridge (`kind: 'grpc'`) instead of manual clients.
  - [x] Expose an HTTP endpoint (`POST /api/sentiment`) that forwards to the gRPC handler and returns the response.
  - [x] Serve a tiny Web UI (simple form -> JSON display) to make the demo approachable.
- [x] Multi-language support:
  - [x] Export `rxpress.grpc.invoke` helper for dynamic backend selection.
  - [x] Add Go backend (`rxpress-bridge-go`) and expose selection in the UI/API.
  - [x] Extend smoke test to exercise both Python and Go bridges.
- [ ] Tooling:
  - [x] Provide helper scripts/dev instructions for running Python + TS services together (smoke test script).
  - [x] Document Python dependency install (requirements + helper).
- [ ] Verification:
  - [ ] Add an automated integration test (ts-node + pytest) to exercise the bridge end-to-end.
  - [x] Provide manual test instructions in README.
- [ ] Documentation polish:
  - [ ] Explain how to adapt the pattern for real sentiment models (detailed examples).
  - [ ] Add troubleshooting tips for control-plane connection inside core docs.
