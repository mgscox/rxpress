# Multi-language Sentiment (rxpress + Python gRPC bridge)

This example shows how `rxpress` (TypeScript) can outsource request handling to a Python service over
the built-in gRPC bridge. It’s intentionally lightweight so you can adapt the pattern for your own
mixed-language projects.

---

## Flow

```
Browser/UI  ──POST /api/sentiment────────────┐
                                             │ rxpress (HTTP)
rxpress (TS) ──Invoker.Invoke───────────────▶│ Python gRPC service
                                             │
rxpress (TS) ◀─ControlPlane.Connect──────────┘ (log/emit/kv feedback)
```

1. The UI (or `curl`) submits text to `/api/sentiment`.
2. The rxpress route is configured with `kind: 'grpc'`, so it forwards the request over the handler
   bridge to Python.
3. The Python helper (`rxpress-bridge-python`) executes the handler, uses keyword heuristics to score
   the sentiment, and returns an HTTP-style payload.
4. Control-plane messages allow the Python code to log, emit events, and access KV state just like an
   in-process handler.

---

## Project layout

```
packages/examples/multi-language-sentiment/
├── src/
│   ├── api/sentiment.handler.ts     # gRPC route config (kind: 'grpc')
│   ├── http/index.handler.ts        # Serves the tiny Web UI
│   └── main.ts                      # Bootstraps rxpress + gRPC bridge registry
├── public/index.html                # Form + JSON output
├── python/sentiment/server.py       # Launches the Python bridge handler
├── .env.example                     # Env vars for HTTP + gRPC bridge
└── README.md                        # This guide
```

The Python helper lives under `packages/rxpress-bridge-python/` and exports utilities for hosting
handlers.

---

## Prerequisites

- Node.js ≥ 20
- Python ≥ 3.10 (with `venv`)
- `grpcio`, `grpcio-tools`, `protobuf`, and `rxpress-bridge` (installed below)

---

## Setup & run

1. **Install Node dependencies** (once at repo root)

   ```bash
   npm install
   ```

2. **Create a Python virtual environment**

   ```bash
   cd packages/rxpress-bridge-python
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -e .  # installs rxpress-bridge helper in editable mode
   deactivate
   ```

3. **Install the Python app requirements**

   ```bash
   cd ../examples/multi-language-sentiment
   python -m venv .venv
   source .venv/bin/activate
   pip install -r python/requirements.txt
   # make the helper visible inside this venv as well
    pip install -e ../rxpress-bridge-python
   ```

4. **Start the Python bridge service**

   ```bash
   CONTROL_TARGET=127.0.0.1:50070 \
   BRIDGE_BIND=127.0.0.1:50055 \
   python python/sentiment/server.py
   ```

5. **In another terminal, start the rxpress app**

   ```bash
   npm run dev --workspace @newintel/multi-language-sentiment
   ```

6. **Test it**
   - Visit <http://localhost:3004/> and submit text.
   - Or run:
     ```bash
     curl -s http://localhost:3004/api/sentiment \
      -H 'content-type: application/json' \
      -d '{"text":"I love this framework"}' | jq
     ```

   ```

   ```

### Automated smoke test

Once you have built the example (`npm run build --workspace @newintel/multi-language-sentiment`),
you can run the bundled smoke test. It starts the compiled rxpress server and the Python bridge,
sends a request, and tears everything down automatically. The script enforces timeouts so it won't
hang if something goes wrong.

```bash
npm run build --workspace @newintel/multi-language-sentiment
npm run smoke --workspace @newintel/multi-language-sentiment
```

You should see a JSON response with polarity, confidence, and per-sentence breakdown.

---

## Python handler snippet

```python
from rxpress_bridge import serve

async def analyse(method, payload, meta, ctx):
    body = payload.get('body') or {}
    text = body.get('text', '')
    score = _score(text)
    await ctx.log('info', 'sentiment scored', {'score': score})
    return {
        'status': 200,
        'body': {
            'text': text,
            'polarity': score,
            'confidence': abs(score) if score else 0.3,
        },
    }

if __name__ == '__main__':
    app = serve(
        bind='127.0.0.1:50055',
        handlers={'sentiment.analyse': analyse},
        control_target='127.0.0.1:50070',
    )
    app.wait_forever()
```

The real script (`python/sentiment/server.py`) includes the keyword heuristics and UI-friendly
breakdown that ship with the example.

---

## Customisation ideas

- Swap the heuristic model for OpenAI, HuggingFace, or spaCy.
- Add event listeners on the rxpress side (`ctx.emit`) to react to sentiment results.
- Use TLS for the bridge by enabling `config.grpc.tls` in `main.ts` and passing the same credentials
  to the Python `grpc.secure_channel`.
- Implement similar helpers in Go/Rust using `handler_bridge.proto`; the Python helper is a reference
  implementation.

---

## Troubleshooting

| Issue                                 | Likely cause                                     | Fix                                                                                                            |
| ------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `404 Not Found` on `/`                | rxpress server not running or handlers not added | Check the terminal running `npm run dev` for errors.                                                           |
| gRPC `UNAVAILABLE` / `ECONNREFUSED`   | Python bridge not running or ports mismatch      | Ensure `BRIDGE_BIND` matches `GRPC_PORT` and `CONTROL_TARGET` matches `GRPC_BRIDGE_BIND`.                      |
| `ModuleNotFoundError: rxpress_bridge` | Helper not installed in venv                     | Run `pip install -e ../../rxpress-bridge-python`.                                                              |
| Logs not appearing / emit failing     | Control-plane connection not established         | Verify `CONTROL_TARGET` points to the rxpress `bind` address and that the app started with `GRPC_BRIDGE_BIND`. |

Enjoy experimenting with multi-language handler orchestration!
