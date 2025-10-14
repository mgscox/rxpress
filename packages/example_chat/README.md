# example_chat

Minimal CLI chat demo built on the locally packed `rxpress` library. It starts an `rxpress` server with a `/chat` API route, forwards prompts to an [OpenAI](https://openai.com/) compatible API via `fetch`, and streams the assistant responses back to your terminal.

## Prerequisites

- Node.js 20+
- OPENAI_API_KEY environment variable defined
- A packed copy of the library (`packages/rxpress-0.1.0.tgz`)

## Install & run

```bash
npm install --workspace example_chat
npm run start --workspace example_chat
```

Type messages at the prompt. The CLI uses `fetch` to call the local `/chat` route, which in turn calls the Ollama chat API. Type `exit` to quit.

You can override the model or endpoint with environment variables:

```bash
OPENAI_MODEL=llama3.1:latest OPENAI_BASE_URL=http://localhost:11434/api OPENAI_API_KEY=ollama npm run start --workspace example_chat
```
