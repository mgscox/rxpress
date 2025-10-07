# Migration Plan: rxpress Library Extraction

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
7. [x] **Wire build tooling:** add `npm run build` to compile to `dist/`, update `package.json` (`main`, `exports`, `types`, clean description, semver). Include `files: ["dist"]` and remove TypeScript sources from publish payload.
8. [x] **Add tests/examples:** port existing smoke tests, add integration tests that spin up express app via library; document fixtures under `__tests__`.
9. [x] **Update docs:** author README usage guide and migration notes; ensure AGENTS.md references new workflow if needed.

### Phase 3 Progress
- [x] Cleaned `package.json` metadata, set version 0.1.0, and limited publish artifacts to `dist` + README.
- [x] Added README quick start documenting adapter expectations.
- [x] Added ts-node driven integration test with stub adapters; skips gracefully when sandbox blocks listening sockets.

- [x] Added CHANGELOG and publishing checklist to document release flow.

- [x] Added cron integration smoke test covering scheduler + event pipeline.

### Phase 3 – Upcoming Focus
- [ ] Begin refactor of `packages/server` to consume the new library API while keeping example routes/events intact.
- [ ] Automate changelog generation / semantic release flow.

## Phase 4 – Consumer Migration
10. [x] **Refactor `packages/server`:** replace local service imports with `rxpress` exports; keep only project-specific routes/events/config.
11. [x] **Provide wrapper bootstrap:** update server startup scripts to call `rxpress.init()`/`start()` instead of bespoke logic; confirm environment loading still works via new API.
12. [ ] **Retire duplicated config service:** remove the local `ConfigService` only if the example server can resolve its root directory through the library API (or an override hook); otherwise document the gap and revisit.

### Phase 4 Progress
- [x] Server example now calls `rxpress.init/start`, registers routes/events through the library, and relies on shared logger/KV adapters.
- [ ] Local `ConfigService` persists to support server-specific helpers; evaluate replacing with library helper or exposing adapter package.

## Phase 5 – Publish Readiness
13. [ ] **End-to-end validation:** run `npm run build --workspace rxpress`, `npm pack` to inspect tarball, and test consuming it from a sample app (`npm init -y && npm install ../rxpress-*.tgz`).
14. [ ] **Version & release:** establish release checklist, bump `version`, add CHANGELOG entry, and prepare `npm publish` workflow.
15. [ ] **Post-publish integration:** update server workspace to depend on published semver (instead of relative path) and verify `npm install rxpress` works in a clean environment.

## Considerations & Risks
- Keep logger/KV integration fully adapter-based; document required interface signatures so teams can slot in console, pino, Redis, memory, or other tooling without coupling.
- Ensure dynamic `glob` loaders resolve correctly once compiled to `dist/` (might require switching to `import.meta.url` relative paths).
- Decide how much telemetry/metrics functionality is core vs optional to keep install size reasonable.
- Document Node.js version requirement (Node 20+) and any peer dependencies (e.g., `express`, `rxjs`).
- Plan for backwards compatibility if external consumers expect existing server behavior; provide migration notes or wrappers.
