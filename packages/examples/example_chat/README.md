# example_chat

Minimal CLI chat demo built on the locally packed `rxpress` library. It starts an `rxpress` server with a `/chat` streaming route, forwards prompts to an [OpenAI](https://openai.com/) compatible API using the official client, and streams assistant tokens back to your terminal in real time.

## Prerequisites

- Node.js 20+
- OPENAI_API_KEY environment variable defined
- `rxpress` built locally (`npm run build --workspace rxpress`)

## Install & run

```bash
npm install --workspace example_chat
npm run start --workspace example_chat
```

Type messages at the prompt. The CLI opens a streaming HTTP connection to the local `/chat` route and renders tokens as they are produced—no SSE frame parsing required. Type `exit` to quit.

You can override the model or endpoint with environment variables:

```bash
OPENAI_MODEL=llama3.1:latest OPENAI_BASE_URL=http://localhost:11434/api OPENAI_API_KEY=ollama npm run start --workspace example_chat
```

## Inplementation notes

The server and CLI client are implemented in the `main.ts` file, with a single API route SSE handler for `/chat` to provide asynchronous data. Whilst we could have written the handler to use Websockets for realtime streaming, or have replicated the OpenAI API interface to enable the client to use OpenAI library, we wanted to highlight the SSE helper utility which handles edge-cases and decoding of NDJSON for you in a simple-to-use function.
