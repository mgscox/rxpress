# Repository Guidelines

## Project Structure & Module Organization
- `packages/rxpress`: ESM library source under `src/` with helper adapters in `src/helpers`, build artefacts emitted to `dist/`, and smoke/integration tests in `__tests__/`.
- `packages/server`: Example host application showing how to consume `rxpress`; server-specific adapters live in `src/services`, and events are defined in `src/events/*.event.js`.
- Workspace tooling (`package.json`, `nx.json`, `lerna.json`) orchestrates shared scripts—run commands from the repo root unless noted.

## Build, Test, and Development Commands
- Install dependencies once via `npm install` (root).  Use `npm run build --workspace rxpress` to compile the library and `npm run build` inside `packages/server` to emit its TypeScript output.
- Execute all library tests with `npm test --workspace rxpress`; the suite covers helper examples, HTTP routing, and cron/event orchestration.
- Example server: develop with `npx nx run server:dev`, build using `npm run build --workspace @newintel/server`, and start compiled output via `npm run start --workspace @newintel/server`.

## Coding Style & Naming Conventions
- TypeScript strict mode is enabled; prefer four-space indentation and avoid default exports for services/adapters.
- Follow Conventional Commits (`feat:`, `fix:`, `chore:` …); linting will be enforced via CI/Husky once configured, so keep files formatted with Prettier defaults.
- Place new runtime schemas/tests beside the feature being updated to keep discovery easy.

## Testing Guidelines
- Name test files `<feature>.test.ts` and rely on Node’s built-in `assert` plus top-level `await` (Node 20+).
- Integration tests spin up ephemeral HTTP servers—skip gracefully if the environment blocks listening, mirroring the existing patterns in `__tests__/`.
- Before opening a PR, run `npm run build --workspace rxpress` and `npm test --workspace rxpress`; add server-side checks as relevant.

## Release Workflow
- Releases are automated with semantic-release. To cut a version manually, ensure `NPM_TOKEN` and `GITHUB_TOKEN` are set, then run `npm run release` from the repo root.
- The workflow rebuilds `packages/rxpress`, updates `packages/rxpress/CHANGELOG.md`, bumps `package.json`, publishes to npm, and pushes the changelog + tag (`rxpress-vX.Y.Z`).
- Avoid manually editing version fields—semantic-release derives the next version from Conventional Commit history.
