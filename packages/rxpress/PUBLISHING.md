# Publishing Checklist

1. **Prerequisites**
   - Node.js 20+ installed.
   - `npm login` with publish rights to the `rxpress` package namespace.
   - Workspace dependencies installed (`npm install`).

2. **Quality Gates**
   - `npm run build --workspace rxpress`
   - `npm test --workspace rxpress` (integration test will skip gracefully if ports are blocked; ensure it passes locally).

3. **Versioning**
   - Update `packages/rxpress/package.json` version (SemVer) and run `npm install` to refresh `package-lock.json`.
   - Append release notes to `packages/rxpress/CHANGELOG.md`.

4. **Pack & Inspect**
   - `npm pack --workspace rxpress`
   - Inspect the generated tarball to confirm only `dist/` assets and README are included.

5. **Publish**
   - `npm publish packages/rxpress --access public`

6. **Post-Release**
   - Tag the commit `git tag vX.Y.Z` and push tags.
   - Update `packages/examples/server` dependency to the published version and run regression tests.
   - Announce release notes (Slack, GitHub Releases, etc.).
