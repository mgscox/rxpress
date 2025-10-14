# example_chat

Minimal CLI chat demo built on the locally packed `rxpress` library. It starts an `rxpress` server with a `/chat` streaming route, forwards prompts to an [OpenAI](https://openai.com/) compatible API using the official client, and streams assistant tokens back to your terminal in real time.

## Prerequisites

- Node.js 20+
- OPENAI_API_KEY environment variable defined
- A packed copy of the library (`packages/rxpress-0.1.0.tgz`)

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
