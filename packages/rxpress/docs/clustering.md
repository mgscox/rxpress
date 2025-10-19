# Clustering

`rxpress` can scale a single application across multiple CPU cores by forking
worker processes that all share the same port. The cluster layer is built on top
of Socket.IO’s [`@socket.io/sticky`](https://github.com/socketio/socket.io-sticky)
and [`@socket.io/cluster-adapter`](https://github.com/socketio/socket.io-redis-adapter/tree/main/packages/cluster-adapter)
packages so that WebSocket traffic remains sticky and broadcasts reach every
worker.

## Enabling the cluster runtime

Pass a `cluster` block to `rxpress.init` and start the process as the primary:

```ts
rxpress.init({
  config: {
    port: 3987,
    hostname: '127.0.0.1',
    cluster: {
      workers: 2, // defaults to the number of CPUs when omitted
      restartOnExit: true, // automatically respawn crashed workers
    },
  },
  logger,
  kv,
});

await rxpress.start();
```

When clustering is enabled, the primary process spins up a lightweight Socket.IO
dispatcher and forks the configured number of workers. Each worker hosts its own
Express server, registers routes/events, and creates a Socket.IO server via the
new `WSSService`. The primary coordinates graceful shutdown and automatically
respawns workers when `restartOnExit` is `true`.

> **Note**: do not call `rxpress.start()` from inside a worker manually. The
> `ClusterService` handles forking and initialising each worker process for you.

## Broadcasting WebSocket messages

The existing `SYS::WSS::BROADCAST` event works cluster-wide:

- When a worker emits the event, the local Socket.IO server delivers the
  message to its own clients and the cluster adapter sends a copy to the
  primary.
- The primary proxies the payload to every other worker, which then emits it to
  their attached clients.
- NOTE: Broadcasts are **not** sent to the initating client

This preserves trace/run context automatically. If you include an `exclude`
array, the worker converts it to a list of socket IDs so the primary can respect
the same exclusions when forwarding to other workers.

## Sticky sessions

Once a websocket is established, the client is served from the same server to avoid
unnecessary reconnections. This is achivved through sticky sessions, and is invisible
unless you run multiple servers, each with clustering, behind a reverse proxy.

Socket.IO requires sticky sessions so follow-up HTTP requests and WebSocket
upgrades land on the same worker. `rxpress` sets a cookie named `rxpress_sid`
during the Engine.IO handshake:

```http
Set-Cookie: rxpress_sid=<value>; Path=/; HttpOnly; SameSite=Lax
```

Inside a single host this cookie lets `@socket.io/sticky` route each connection
to the correct worker. For multi-host deployments configure your load balancer
to use the same cookie when selecting a backend instance. If you prefer a
different cookie name you can still override the balancer configuration; the
library simply provides a default.

### Load balancing across hosts

When you place a reverse proxy or load balancer in front of multiple hosts you
still need external stickiness so that the entire socket session always reaches
the same machine. Cookie-based routing is recommended:

- **NGINX**: `sticky cookie rxpress_sid expires=1h domain=.example.com path=/;`
- **AWS ALB**: enable application-based stickiness and set the cookie name to
  `rxpress_sid`.

IP-hash routing (`x-forwarded-for`) can work in a pinch, but cookies are more
robust because many clients can share an IP address (corporate networks, mobile
carriers, etc.).

## Worker lifecycle and observability

- All worker processes emit lifecycle events (`SYS::CLUSTER::*`) so you can log
  or trace fork/ready/shutdown activity. The primary listens for READY/ACK
  messages and only reports success once every worker has booted.
- `rxpress.stop()` triggers a graceful shutdown: the primary broadcasts a
  `cluster:shutdown` message, each worker closes its WebSocket server, emits
  `SYS::SHUTDOWN`, and acknowledges completion before the primary exits.

## Testing

Clustered WebSockets are covered by the integration test
`rxpress.cluster.test.ts`, which spins up a two-worker fixture, connects two
Socket.IO clients, triggers a broadcast via an HTTP route, and asserts both
clients receive the payload. When running tests locally remember to allow the
process to bind to the selected hostname/port (the CI environment skips the test
if it encounters `EACCES`/`EPERM`).
