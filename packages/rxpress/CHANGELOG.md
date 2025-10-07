# Changelog

## v0.1.0 - 2025-02-14

### Added
- Core `rxpress` namespace with `init`, `start`, `stop`, and dynamic loader helpers for routes, events, and cron jobs.
- Adapter-friendly logger and KV interfaces, plus configurable root directory and env loading hooks.
- OpenTelemetry metrics wiring, cron orchestration, and route validation powered by Zod.
- ESM-ready TypeScript build targeting NodeNext with declaration output.
- Integration smoke test and README quick start demonstrating stub adapters.

### Fixed
- Express routes registered via `rxpress.addHandlers` are now mounted automatically.

### Internal
- Package metadata trimmed for npm publication; restrict tarball to compiled `dist/` artifacts and README.
