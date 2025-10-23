# AI Deep Research Agent (rxpress)

This example demonstrates a deep-research workflow on top of [`rxpress`](../../rxpress) with a Web UI. A user can submit a research prompt, track the multi-depth pipeline, and ingest the final report without leaving the browser.

## Highlights

- 🔁 **Event-driven orchestration** – rxpress events mirror the original Motia steps (query generation → search → extraction → analysis → follow-up → report).
- 🌐 **Firecrawl + OpenAI integration** – Firecrawl discovers and scrapes sources; OpenAI synthesises insights and compiles the final report.
- 💾 **File-backed state** – research state persists to `data/` via a JSON-backed KV decorator so restarts keep existing jobs.
- 🖥️ **Polished Web UI** – the example serves a single-page app for job submission, progress polling, and report viewing.
- 🧪 **Local utility tests** – lightweight Node tests cover the job-state helper behaviour.

## Project layout

```
packages/examples/ai-deep-research/
├── public/                    # Web UI assets (single-page app)
├── src/
│   ├── api/                   # REST handlers (start/status/report/config)
│   ├── events/                # rxpress event handlers (*.event.ts)
│   ├── http/                  # HTTP handler to serve the UI shell
│   ├── services/              # Firecrawl/OpenAI clients + persisted KV
│   ├── types/                 # Shared interfaces for the pipeline
│   └── __tests__/             # Node test for job-store utilities
├── data/                      # JSON KV snapshots (created at runtime)
├── package.json               # Example package manifest
└── tsconfig.json
```

## Prerequisites

- Node.js 20+
- npm 10+
- Firecrawl + OpenAI API keys

## Quick start

```bash
# From repo root
cp packages/examples/ai-deep-research/.env.example .env
# add OPENAI_API_KEY / FIRECRAWL_API_KEY

npm install
npm run build --workspace @newintel/ai-deep-research
npm run start --workspace @newintel/ai-deep-research
```

The service defaults to `http://localhost:3003`. Visit the root path to launch the Web UI.

> **Note on OpenAI models**
>
> The example targets the Chat Completions API using GPT‑5 suite of language models, which do not support temperature settings. Other models that honour sampling controls will continue to work without code changes with their default values.

### Environment

| Variable                              | Purpose                                   | Default                            |
| ------------------------------------- | ----------------------------------------- | ---------------------------------- |
| `OPENAI_API_KEY`                      | Required for analysis + report synthesis  | –                                  |
| `OPENAI_MODEL`                        | Chat Completions model name               | `gpt-4o-mini`                      |
| `FIRECRAWL_API_KEY`                   | Required for search/scrape                | –                                  |
| `FIRECRAWL_API_URL`                   | Optional custom Firecrawl host            | Firecrawl cloud                    |
| `FIRECRAWL_CONCURRENCY_LIMIT`         | Parallel scrape batch size                | `2`                                |
| `FIRECRAWL_BATCH_DELAY_MS`            | Delay between scrape batches              | `2000`                             |
| `FIRECRAWL_MAX_RETRIES`               | Retry attempts for Firecrawl calls        | `3`                                |
| `PORT`                                | HTTP port                                 | `3003`                             |
| `HOSTNAME`                            | Server                                    | `localhost`                        |
| `OTEL_ENABLE`                         | Set to `true` to emit OTLP metrics/traces | `false`                            |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Override OTLP metrics URL (when enabled)  | `http://localhost:4318/v1/metrics` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`  | Override OTLP traces URL (when enabled)   | `http://localhost:4318/v1/traces`  |

State is written to `packages/examples/ai-deep-research/data/ai-deep-research-state.json`. Delete the file to reset.

## Web UI walkthrough

1. Enter a topic plus breadth/depth controls (breadth = distinct queries, depth = follow-up levels).
2. Submit to kick off the pipeline. The UI polls `/api/research/:id/status` every ~2.5s.
3. Once the report is ready, the UI fetches `/api/research/:id/report` and renders summary, sections, and sources.
4. Use “Run Another Research” to reset while preserving historical jobs in the JSON store.

The UI also reads `/api/research/config` to stay aligned with server limits.

## API surface

| Method | Path                       | Description                                                                        |
| ------ | -------------------------- | ---------------------------------------------------------------------------------- |
| `POST` | `/api/research`            | Submit a new job (`query`, `breadth`, `depth`). Returns job id + initial progress. |
| `GET`  | `/api/research/:id/status` | Inspect job status, progress, and whether a report is ready.                       |
| `GET`  | `/api/research/:id/report` | Fetch the final report payload.                                                    |
| `GET`  | `/api/research/config`     | Retrieve defaults/limits for form validation.                                      |

On failures (missing credentials, external API issues) the job status flips to `failed`, and the status endpoint surfaces the error message.

## Development commands

```bash
npm run dev --workspace @newintel/ai-deep-research   # ts-node + live reload main entry
npm run test --workspace @newintel/ai-deep-research  # node --test via ts-node
npm run lint --workspace @newintel/ai-deep-research  # eslint over src
npm run build --workspace @newintel/ai-deep-research # compile to dist/
```

## Smoke test recipe

1. Populate `.env` with valid `OPENAI_API_KEY` and `FIRECRAWL_API_KEY`.
2. Run `npm run dev --workspace @newintel/ai-deep-research`.
3. Navigate to `http://localhost:3003/` and submit a topic (e.g. _“Impacts of low-earth-orbit satellites on agriculture monitoring”_).
4. Confirm the status badge advances from `QUEUED` → `RUNNING` and the progress bar moves.
5. Verify the final report renders with sections, takeaways, and source links.
6. Check `data/ai-deep-research-state.json` to see persisted job metadata.

## Troubleshooting

- **`OPENAI_API_KEY is required`** – ensure `.env` is loaded before starting the server.
- **Firecrawl 429 responses** – lower `FIRECRAWL_CONCURRENCY_LIMIT`, increase `FIRECRAWL_BATCH_DELAY_MS`, or raise `FIRECRAWL_MAX_RETRIES`.
- **Stuck status** – inspect server logs for failure messages; jobs that error remain in the JSON file with `status: failed` for post-mortem analysis.
