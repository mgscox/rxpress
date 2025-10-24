# Multi-language Sentiment (rxpress + Python / Go gRPC bridges)

This workspace shows how `rxpress` can call out to gRPC handlers implemented in other
languages. The same HTTP endpoint can fan out to either a Python or a Go sentiment
service simply by flipping a selector in the UI (or the request payload).

---

## Flow overview

```
Browser ──POST /api/sentiment──┐
                               │  rxpress (TypeScript)
                               │   • hosts HTTP + UI
                               │   • exposes ControlPlane (bind)
                               │   • forwards invoke() over gRPC
                               │
                 Python bridge ├── handler_bridge.proto → analyse()
                 Go bridge     ┘   (shares logging / emit / kv helpers)
```

The bridges connect back to rxpress via the control plane so they can log, emit
events, and use the same KV APIs as in-process handlers.

---

## Project layout

```
packages/examples/multi-language-sentiment/
├── src/
│   ├── api/sentiment.handler.ts   # Local route that calls grpc.invoke dynamically
│   ├── http/index.handler.ts      # Serves the single-page HTML UI
│   └── main.ts                    # Bootstraps rxpress + registry for each backend
├── public/index.html              # Tailwind-inspired UI with backend selector
├── python/sentiment/server.py     # Python reference implementation (rxpress-bridge-python)
├── scripts/smoke.cjs              # Builds, runs, and verifies both backends
└── README.md                      # You are here
```

Companion bridge helper packages:

- `packages/rxpress-bridge-python/` – async-friendly helper used by the Python bridge.
- `packages/rxpress-bridge-go/` – newly added Go helper + sample sentiment server.

---

## Prerequisites

- Node.js ≥ 20
- Python ≥ 3.10 (with `venv`)
- Go ≥ 1.22

Install JS deps once from the repository root:

```bash
npm install
```

---

## Python bridge setup

```bash
# 1. Install the Python helper (editable)
cd packages/rxpress-bridge-python
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
deactivate

# 2. Install the example's Python dependencies
cd ../examples/multi-language-sentiment
python -m venv .venv
source .venv/bin/activate
pip install -r python/requirements.txt
# expose the helper inside this virtualenv
pip install -e ../../rxpress-bridge-python
```

Run the Python backend:

```bash
CONTROL_TARGET=127.0.0.1:52070 \
BRIDGE_BIND=127.0.0.1:52055 \
python python/sentiment/server.py
```

---

## Go bridge setup

The Go bridge lives in `packages/rxpress-bridge-go/` and exports a reusable `bridge.Serve`
API. A sentiment sample is included under `cmd/sentiment`.

```bash
cd packages/rxpress-bridge-go
# optional: cache dependencies
go mod download

# run the bridge (defaults match the rxpress config)
BRIDGE_BIND=127.0.0.1:52065 \
CONTROL_TARGET=127.0.0.1:52070 \
go run ./cmd/sentiment
```

You can also build a binary:

```bash
GOOS=linux GOARCH=amd64 go build -o ./bin/sentiment ./cmd/sentiment
./bin/sentiment
```

---

## Start rxpress & UI

In a separate shell, start the example (uses ts-node in dev mode):

```bash
npm run dev --workspace @newintel/multi-language-sentiment
```

With both bridges offline you can still hit the UI at <http://localhost:3004/>, but
requests will fail. Start whichever backend(s) you want and re-submit.

### Selecting a backend

The UI exposes a dropdown (Python or Go). Programmatic callers can include the
`backend` property in the JSON body:

```bash
curl -s http://localhost:3004/api/sentiment \
  -H 'content-type: application/json' \
  -d '{"text":"I love gRPC bridges","backend":"go"}' | jq
```

The response mirrors the backend provider and always echoes the selected `backend`.

---

## Automated smoke test

After building the example, the smoke script launches rxpress once and exercises both
bridges sequentially. Each process is wrapped with timeouts so it shuts down cleanly.

```bash
npm run build --workspace @newintel/multi-language-sentiment
npm run smoke --workspace @newintel/multi-language-sentiment
```

---

## Environment variables

`.env.example` documents the key switches:

| Variable           | Description                                   | Default           |
| ------------------ | --------------------------------------------- | ----------------- |
| `PORT`             | HTTP port for rxpress                         | `3004`            |
| `GRPC_BRIDGE_BIND` | Address rxpress listens on for bridge control | `127.0.0.1:52070` |
| `PYTHON_GRPC_PORT` | Python bridge listening port                  | `50055`           |
| `GO_GRPC_PORT`     | Go bridge listening port                      | `52065`           |
| `OTEL_ENABLE`      | Enable OpenTelemetry export                   | `false`           |

Set `PYTHON_GRPC_HOST` / `GO_GRPC_HOST` if the bridges run on another machine.

---

## Troubleshooting

| Issue / Error                          | Likely cause                                   | Fix                                                                                       |
| -------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `12 UNIMPLEMENTED: Method not found!`  | Bridge started without registering the handler | Ensure `sentiment.analyse` is present in the handlers map.                                |
| `connect ECONNREFUSED 127.0.0.1:52070` | Bridge cannot reach rxpress control plane      | Confirm rxpress is running with `GRPC_BRIDGE_BIND` and the bridge `CONTROL_TARGET` match. |
| Response `backend` ≠ requested backend | Old cached UI payload                          | Refresh the page or clear the form before submitting.                                     |
| Smoke test hangs                       | One of the bridge processes never logs ready   | Check the console output—timeouts are enforced but large Go builds may need more time.    |

---

## Next steps

- Add more languages by porting the handler bridge (`handler_bridge.proto`) to C#, Rust, etc.
- Swap the heuristic scoring for a proper ML model or an LLM call.
- Use the `ctx.emit` helper in the bridge to publish events back into rxpress for observability.
