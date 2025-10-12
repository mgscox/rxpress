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

For one-way streaming, declare routes with `type: 'sse'`. Inside the handler use the `stream` helper to push messages.

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

Handlers declared with `type: 'sse'` always receive a concrete `stream`; other route types see it undefined. SSE routes automatically set headers, keep the connection alive, and close gracefully when the client disconnects or you call `rxpress.stop()`.

## Metrics & Tracing

Realtime endpoints participate in the same OpenTelemetry instrumentation as traditional HTTP routes, so you can monitor message rates and latencies alongside REST endpoints.
