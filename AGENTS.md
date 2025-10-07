# Repository Guidelines

## Project Structure & Module Organization
- `packages/server`: TypeScript Nx application powering the runtime RPC/Event gateway; entry point `src/main.ts`, domain helpers under `src/services`, event handlers in `src/events`, and shared contracts in `src/types`.
- `packages/rxpress`: CommonJS helper library published as `rxpress`; compiled artifacts in `lib`, smoke tests in `__tests__`.
- Tooling metadata (`nx.json`, `lerna.json`, root `package.json`) manage workspaces—run commands from the repo root so workspace resolution and path aliases stay intact.

## Build, Test, and Development Commands
- Install dependencies once with `npm install`.
- Develop the server in watch mode via `npx nx run server:dev` (wraps `npm run dev --workspace @newintel/server` and registers the ts-node loader).
- Produce a production build with `npm run build --workspace @newintel/server`; output lands in `packages/server/dist`.
- Start the compiled server using `npm run start --workspace @newintel/server`.
- Execute library tests with `npm test --workspace rxpress`; add new suites under `packages/rxpress/__tests__`.

## Coding Style & Naming Conventions
- Use TypeScript ES modules inside `packages/server` (strict mode, Node 20 target). Prefer four-space indentation to match existing sources.
- Export classes as PascalCase (e.g., `EventService`), functions/constants camelCase, and enums or union tags in SCREAMING_SNAKE_CASE when needed.
- Validate runtime payloads with `zod` schemas; place new schemas beside the owning route or event definition for discoverability.
- No auto-formatters are configured—run `tsc` locally before committing to catch structural issues.

## Testing Guidelines
- Co-locate integration tests beside features (`src/events/**/__tests__` or similar) and reuse Node’s built-in `assert` or a lightweight runner.
- Name test files `<feature>.test.(ts|js)` so they remain executable via plain `node`.
- Cover new routes, emitted topics, and configuration branches; document any intentional gaps in the PR description.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (`feat:`, `fix:`, `chore:`) as seen in history (`feat: Add configuration service`).
- Each PR should describe scope, link Jira/GitHub issues, and include manual test notes or screenshots for API changes.
- Request review once the build commands above succeed locally; flag breaking changes prominently in the summary.
