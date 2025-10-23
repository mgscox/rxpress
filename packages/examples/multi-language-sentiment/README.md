# Multi-language Sentiment (rxpress + Python gRPC)

This example keeps the sentiment logic in Python while `rxpress` handles HTTP routing and UX. The Python service listens over gRPC; the TypeScript app forwards requests and displays the results. It is deliberately lightweight so you can reuse the pattern for your own cross-language integrations.

---

## What you get

| Piece              | Location                                         | Notes                                                                       |
| ------------------ | ------------------------------------------------ | --------------------------------------------------------------------------- |
| HTTP/API server    | `src/main.ts`, `src/api/sentiment.handler.ts`    | rxpress boots, registers handlers explicitly, and exposes `/api/sentiment`. |
| gRPC client        | `src/services/sentiment-client.ts`               | Uses `@grpc/proto-loader` + `@grpc/grpc-js` to call the Python service.     |
| Web UI             | `public/index.html`, `src/http/index.handler.ts` | Simple form that posts text and renders the JSON response.                  |
| Proto contract     | `proto/sentiment.proto`                          | Minimal request/response definition (text in, polarity/ confidence out).    |
| Python gRPC server | `python/sentiment/server.py`                     | Implements `sentiment.SentimentService.Analyse` using keyword heuristics.   |

The architecture mirrors `packages/rxpress/__tests__/rxpress.grpc-health.test.ts`, but the remote handler is written in Python instead of TypeScript.

---

## Running the demo locally

> **Prerequisites:** Node.js ≥ 20, Python ≥ 3.10, `curl` or a browser.

1. **Install Python dependencies**

   ```bash
   cd packages/examples/multi-language-sentiment
   # optional: python3 -m venv .venv && source .venv/bin/activate
   python -m pip install -r python/requirements.txt
   ```

2. **Start the Python gRPC service** (listens on `127.0.0.1:50055`)

   ```bash
   python python/sentiment/server.py
   ```

3. **Start the rxpress app**

   ```bash
   npm run dev --workspace @newintel/multi-language-sentiment
   ```

4. **Test it**
   - Web UI: <http://localhost:3004/>
   - CLI:
     ```bash
     curl -s http://localhost:3004/api/sentiment \
       -H 'content-type: application/json' \
       -d '{"text":"I love this framework"}' | jq
     ```

You should receive a JSON payload containing the detected language, polarity score (−1 to 1), confidence value, and a per-sentence breakdown.

---

## How the pieces fit together

1. `src/main.ts` initialises rxpress, attaches CORS, and registers two handlers:
   - `src/http/index.handler.ts`: serves the HTML UI.
   - `src/api/sentiment.handler.ts`: parses requests and calls the gRPC client.
2. `src/services/sentiment-client.ts` loads `proto/sentiment.proto`, creates a gRPC client, and exposes `analyseSentiment(text, languageHint?)`.
3. `python/sentiment/server.py` constructs protobuf descriptors at runtime and registers a unary RPC handler that scores the text via keyword heuristics.
4. Responses flow back to rxpress, which returns them as JSON to the caller. The UI simply displays the JSON result.

This setup keeps both sides isolated: you can replace the Python implementation with any gRPC-compatible runtime (Go, Rust, etc.) and the TypeScript code will keep working.

---

## Extending the demo

- **Use real sentiment models:** swap the keyword heuristic for TextBlob, spaCy, HuggingFace, or OpenAI from within the Python service.
- **Adopt rxpress’s full bridge:** implement `packages/rxpress/src/grpc/handler_bridge.proto` in Python to gain logging, KV, and emit support across the language boundary.
- **Add authentication or metadata:** populate headers in `sentiment-client.ts` and extract them in the Python service to drive per-tenant logic.
- **Turn it into a microservice:** deploy the Python process separately and point `GRPC_HOST` / `GRPC_PORT` at its address. The TypeScript side already reads those env vars.

---

## Troubleshooting

| Symptom                                      | Likely cause                     | Fix                                                                                                                  |
| -------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `404 Not Found` on `/`                       | rxpress didn’t register handlers | Make sure you’re running the updated `main.ts` (handlers added via `rxpress.addHandlers`) and restart `npm run dev`. |
| `ECONNREFUSED` when calling `/api/sentiment` | Python gRPC server not running   | Start `python python/sentiment/server.py` (or check host/port env vars).                                             |
| `AttributeError: MessageFactory`             | Older protobuf API in use        | The repo now uses `GetMessageClass`; reinstall dependencies if needed.                                               |
| UI hangs                                     | CORS / network issue             | Ensure you’re hitting the same host/port as the rxpress server and that no firewall blocks port `3004`.              |

---

Questions or improvements? Feel free to open an issue or PR so other rxpress users can benefit from the pattern.
