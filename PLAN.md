# Migration Plan: rxpress Library Extraction

Always ensure this document remains up-to-date with progress

## Goals

- [ ] Extract the reusable RxJS-driven web server stack from `packages/server` into `packages/rxpress`.
- [ ] Ship a TypeScript-friendly package that external apps can consume via `npm i rxpress`.
- [ ] Leave `packages/server` as a thin example/host that depends on the published library.

## Current Status Snapshot

- `packages/rxpress/lib` already mirrors some server services but is incomplete (mixed `.ts` sources, no build pipeline, no exported entry point).
- `packages/server` owns the production-ready implementations (`EventService`, `Logger`, `ConfigService`, RPC route/event definitions, CRON wiring).
- Workspace tooling uses Nx + npm workspaces; there is no dedicated publish flow for `rxpress`.

## Phase 1 – Inventory & Hardening

1. [x] **Audit server features:** catalogue route/event/cron helpers, metrics, logging, KV store expectations, and config contracts still living only in `packages/server`.
2. [x] **Align TypeScript configs:** create `packages/rxpress/tsconfig.json` (emit to `dist/`, ES2022 target, declaration output) and add build/test scripts.
3. [x] **Drop ad-hoc TS in `lib/`:** relocate sources to `src/` to match TS build output, keeping `.d.ts` generation in mind.

### Phase 1 Findings

- [x] `packages/server/src/main.ts` orchestrates express server setup, dynamic loading of routes/events, and uses `ConfigService.__rootDir` plus `glob` to discover handlers.
- [x] Logging relies on `Logger` wrapping EventService (`app::log` topic) with env-driven levels; no equivalent concrete logger bundled in `rxpress`.
- [x] `KVService` provides optional file persistence and seeds keys relative to `ConfigService.__rootDir`; `rxpress` exposes only `KVBase` interface without storage implementation.
- [x] Events (`src/events/*.app-log.js`) demonstrate log sinks and expect `logger`/`trigger` context; cron wiring currently exists only in `packages/rxpress` (library) and is unused by server example.
- [x] Metrics, process handlers, and OTEL setup live in `rxpress/lib/services/metrics.service.ts` but server `main.ts` still configures emits/topics manually; need unified bootstrap.
- [x] Type declarations in `packages/server/src/types/rpc.ts` depend on concrete `Logger` and `KVService`; library variant already abstracts these via interfaces.

## Phase 2 – Core Library Port

4. [x] **Port services/types:** move `ConfigService`, `EventService`, route orchestrator, metrics, cron, and typing utilities from server into `rxpress/src`, merging with any partial implementations already there.
5. [x] **Design pluggable infrastructure:** define minimal logger/KV/process handler interfaces so consumers can attach adapters (pino/console/morgan, Redis/in-memory, etc.); keep `rxpress` agnostic to concrete implementations and avoid bundling defaults.
6. [x] **Rebuild orchestrator API:** expose `init/start/stop/load` entry points in `src/index.ts`, ensure dynamic loader paths work outside the monorepo (avoid `ConfigService.__rootDir` assumptions).

### Phase 2 Progress

- [x] Switched `rxpress` build to NodeNext ESM output with explicit `.js` extensions and runtime guards.
- [x] Declared package dependencies (express, glob, cron, RxJS, OTEL) under `packages/rxpress/package.json` to satisfy TypeScript and publish requirements.
- [x] Added ts-node based smoke test and `tsconfig` tuned for `src/` sources; `npm run build --workspace rxpress` now succeeds.
- [x] Logger and KV adapters stay consumer-supplied; rxpress exposes interfaces plus new config hooks for rootDir/envFiles.

## Phase 3 – Packaging & Verification

7. [x] **Wire build tooling:** add `npm run build` to compile to `dist`, update `package.json` (`main`, `exports`, `types`, clean description, semver). Include `files: ["dist"]` and remove TypeScript sources from publish payload.
8. [x] **Add tests/examples:** port existing smoke tests, add integration tests that spin up express app via library; document fixtures under `__tests__`.
9. [x] **Update docs:** author README usage guide and migration notes; ensure AGENTS.md references new workflow if needed.
10. [x] **Refactor `packages/server`:** replace local service imports with `rxpress` exports; keep only project-specific routes/events/config.
11. [x] **Provide wrapper bootstrap:** update server startup scripts to call `rxpress.init()`/`start()` instead of bespoke logic; confirm environment loading still works via new API.

### Phase 3 Progress

- [x] Cleaned `package.json` metadata, set version 0.1.0, and limited publish artifacts to `dist` + README.
- [x] Added README quick start documenting adapter expectations.
- [x] Documented helper adapters under `src/helpers` and wired README examples to real implementations.
- [x] Added ts-node driven integration test with stub adapters; skips gracefully when sandbox blocks listening sockets.

- [x] Added CHANGELOG and publishing checklist to document release flow.

- [x] Added cron integration smoke test covering scheduler + event pipeline.
- [x] Automated semantic-release workflow with changelog, npm publish, and git tagging.
- [x] README helper example covered by automated integration test.
- [x] Observability dashboard plots “Total rxpress requests” via Prometheus (other panels pending).

### Phase 3 – Upcoming Focus

- [x] Add automated test that compiles the README helper example to guard against regressions.
- [x] Document how to run the `npm run release` workflow (semantic-release) in CONTRIBUTING/README.

## Phase 4 – Consumer Migration

12. [x] **Retire duplicated config service:** removed local ConfigService after exposing root resolution via library helpers.

### Phase 4 Progress

- [x] Server example now calls `rxpress.init/start`, registers routes/events through the library, and relies on shared logger/KV adapters.
- [x] Local ConfigService removed; server uses shared helper configuration.

## Phase 5 – Publish Readiness

13. [ ] **End-to-end validation:** run `npm run build --workspace rxpress`, `npm pack` to inspect tarball, and test consuming it from a sample app (`npm init -y && npm install ../rxpress-*.tgz`).
14. [x] **Lint & format automation:** wired ESLint + Prettier into CI workflow and added Husky/lint-staged pre-commit checks.
15. [ ] **Version & release:** establish release checklist, bump `version`, add CHANGELOG entry, and prepare `npm publish` workflow.
16. [ ] **Post-publish integration:** update server workspace to depend on published semver (instead of relative path) and verify `npm install rxpress` works in a clean environment.
17. [x] **Observability stack:** added Docker Compose (OTel Collector + Grafana) and default server telemetry configuration. Sample Grafana dashboard auto-provisioned via docker-compose.

## Phase 6 – gRPC Handler Support (polyglot-ready)

18. [x] **Design bridge service:** create `GrpcBridgeService` under `packages/rxpress/src/services/grpc.service.ts` that loads `handler_bridge.proto`, hosts `Invoker` + `ControlPlane`, and exposes `init`, `invokeRoute`, and `invokeEvent` APIs. Move the proto into the library (e.g., `packages/rxpress/src/grpc/proto/handler_bridge.proto`) and ensure it ships in the bundle.
19. [x] **Extend configuration types:** update `RxpressConfig`, `RPCConfig`, and `EventConfig` to support `{ kind: 'grpc'; handlerName: string; target?: string; timeoutMs?: number; metadata?: Record<string,string>; }` alongside existing local handlers. Provide `grpc` root config (proto path, default target, optional local handler directories) in `packages/rxpress/src/types/index.ts`.
20. [x] **Integrate with routes/events:** modify `RouteService` and `EventService` so entries marked `kind: 'grpc'` forward requests via `GrpcBridgeService`, carry run IDs/span context in `InvokeRequest.meta`, and translate `InvokeResponse` payloads/errors back into current HTTP/event semantics.
21. [x] **Context bridging:** implement ControlPlane handling that maps remote `log`, `emit`, and `kv` operations onto Rxpress’ logger, `EventService.emit`, and KV adapters (including run-scoped KV keys). Add cleanup to release run scopes when the stream closes.
22. [x] **Local handler bootstrap:** add optional `grpc.localHandlers` config that loads TypeScript handlers (mirroring `grpc_example/orchestrator/handlers`) so existing projects can adopt gRPC without remote processes. Ensure future remote handlers can reuse the same proto without code changes.
23. [x] **Testing matrix:** create integration tests in `packages/rxpress/__tests__/` covering (a) HTTP route invoking a gRPC handler, (b) event subscription invoking a gRPC handler, and (c) run-scope propagation across the boundary. Tests should assert `log`, `emit`, and `kv` round-tripping via ControlPlane.
24. [x] **Documentation updates:** document gRPC usage in `packages/rxpress/docs/` (new `grpc.md`, references in routing/events guides, README quick links) including polyglot handler guidance, configuration examples, and local vs remote handler deployment notes.
25. [x] **Future remote support notes:** documented the remaining gRPC roadmap and stood up first-class health checks plus file-based discovery refresh. Follow-on items now focus on:
    - Extending discovery beyond static files (e.g., DNS/service registry adapters, dynamic scale-out).
    - Streaming RPC support (allow long-lived bidi streams for real-time workflows).
    - Operational tooling (metrics on bridge throughput/errors, admin endpoints to list active handler connections).

## gRPC Next steps

- [x] Implement service discovery/health checks so the bridge can target multiple remote handler hosts.
- [ ] Add mTLS to secure traffic between the Node.js orchestrator and remote language runtimes.
- [ ] Extend your handlers with streaming RPCs when you need long-lived bidirectional workflows.

## Considerations & Risks

- Keep logger/KV integration fully adapter-based; document required interface signatures so teams can slot in console, pino, Redis, memory, or other tooling without coupling.
- Ensure dynamic `glob` loaders resolve correctly once compiled to `dist/` (might require switching to `import.meta.url` relative paths).
- Decide how much telemetry/metrics functionality is core vs optional to keep install size reasonable.
- Document Node.js version requirement (Node 20+) and any peer dependencies (e.g., `express`, `rxjs`).
- Plan for backwards compatibility if external consumers expect existing server behavior; provide migration notes or wrappers.
