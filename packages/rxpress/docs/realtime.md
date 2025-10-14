# Realtime Features

`rxpress` supports two complementary realtime transports: WebSockets and Server-Sent Events (SSE).

## WebSockets

The built-in `WSSService` upgrades the HTTP server to accept WebSocket connections once `rxpress.start` runs. Broadcast messages by emitting the `SYS::WSS::BROADCAST` event:

```ts
rxpress.addEvents({
  subscribe: ['SYS::WSS::CONNECTION'],
  handler: async (payload, { emit }) => {
    emit({ topic: 'SYS::WSS::BROADCAST', data: payload });
  },
});
```

The service serialises JSON payloads automatically. Clients connect to `ws://<host>/` unless you override `wsPath` in the configuration.

```ts
rxpress.init({
  config: {
    wsPath: '/socket',
  },
  logger,
  kv,
});
```

## Server-Sent Events

For one-way streaming, declare routes with `type: 'sse'`. Inside the handler use the `stream` helper to push messages. By default `rxpress` sends payloads as raw chunks (strings, buffers, or JSON-serialised objects), so consumers can iterate the response body directly.

```ts
const sseRoute: RPCConfig = {
  type: 'sse',
  method: 'GET',
  path: '/events/ticker',
  handler: async (_req, { stream }) => {
    let counter = 0;
    const interval = setInterval(() => {
      stream.send({ count: counter++ });
    }, 1000);

    // Clean up when the client disconnects
    stream.error = () => clearInterval(interval);
  },
};
```

Handlers declared with `type: 'sse'` always receive a concrete `stream`; other route types see it undefined. SSE routes automatically set headers, keep the connection alive, and close gracefully when the client disconnects or you call `rxpress.stop()`. If you attach a `responseSchema` (e.g., a `z.object`) the library validates each message and emits newline-delimited JSON so clients can call `JSON.parse` per chunk. Leave `responseSchema` unset to stream raw strings/buffers, or set `streamFormat: 'event'` to opt back into classic Server-Sent Event framing (`event:`/`data:` lines).

### Client-side chunk decoding with `SSEChunkHandler`

To keep client code small, `rxpress` exports an `SSEChunkHandler` helper that reads an SSE/NDJSON response body and emits normalised events. The helper accumulates partial frames, parses JSON when possible, and surfaces two event hooks:

- `delta` – fired for each parsed chunk (ideal for printing tokens)
- `complete` – fired when the stream ends; receives the concatenated payload

```ts
import { SSEChunkHandler } from 'rxpress';

const handler = await SSEChunkHandler({
  parse: (line) => JSON.parse(line),
});

handler.on('delta', (part) => {
  process.stdout.write(part.choices?.[0]?.delta?.content ?? '');
});

handler.on('complete', () => process.stdout.write('\n'));

const response = await fetch('http://localhost:3002/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: 'Hello' }),
});

await handler.run(response.body!);
```

Pass a custom `parse` function if you prefer to keep the payload as raw strings, or wire in a logger via the `logger` option for debug diagnostics. The helper works with any `ReadableStream` that follows the newline-delimited contract produced by `stream.send` + `responseSchema`.

## Metrics & Tracing

Realtime endpoints participate in the same OpenTelemetry instrumentation as traditional HTTP routes, so you can monitor message rates and latencies alongside REST endpoints.
