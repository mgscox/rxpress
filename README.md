# rxpress

## About **rxpress**

`rxpress` is an event-driven, asychronous application server, built upon nodeJs and expressJs using rxjs. Event-driven systems provide the foundation for true scalability, resilience, and adaptability that modern applications demand

- **Data drvien** HTTP requests, API interfactions, CRON jobs, Websocket connections all publish events to which common `Event Handlers` subscribe
- **Abstraction** Server implementation only needs implement `Event Handlers`, everything else is taken care of for you
- **Configurable** Extensive options for tailoring and configuring your specific implementation
- **Monitoring** OpenTelemetry statistics and Flows are published automatically
- **Validation** Requests and Responses automatically verified against zod schemas

## Concept

1. **Event Trigger** an "external" action which causes an event to be emitted (e.g. HTTP request, CRON job, Websocket connection)
2. **Event Emitters** publish events (optionally with context data) which Event Hanlders subscribe to. Anything can emit an event.
3. **Event Subscription** determins which events are handled
4. **Event Handlers** implement the business logic. They are inherently stateless but share context, and can interface to backend storage for persistence.

## Repository

This is a Lerna monorepo for `rxpress` library, it contains both a library and example server in separate packages.

## Quick start

```bash
npm install rxpress
```

```ts
import { rxpress } from 'rxpress';
import type { RPCConfig, EventConfig } from 'rxpress';

// Copy/clone helpers from the /packages/rxpress/src/helpers folder in the rxpress repository, or roll your own
import { createSimpleLogger } from './src/helpers/simple-logger.service.js';
import { createMemoryKv } from './src/helpers/memory-kv.service.js';

// Route Handlers can be auto-discovered from files, or programmatically defined
const routes: RPCConfig[] = [
  {
    type: 'api', // 'api' auto-returns Content-Type of "application/json"
    method: 'GET', // 'GET' | 'POST' | 'PUT' | 'DELETE'
    path: '/health', // the http path to handle
    middleware: [], // run any ExpressJS middleware for this route
    handler: async (req, { emit, kv, logger }) => {
      logger.info(`/health route called`); // log a message
      const newValue = kv.inc('counter'); // increment value of a key (auto-created)
      emit('log_counter', { counter: newValue }); // emit an async-event
      return { status: 200, body: { ok: true } }; // return JSON payload to client
    },
  },
];

// Event Handlers can be auto-discovered from files, or programmatically defined
const events: EventConfig[] = [
  {
    subscribe: ['log_counter'], // handler for 'log_counter' event
    handler: async (input, { logger }) => {
      const { counter } = input as { counter: number }; // alternatively, type-cast the "handler" function
      logger.debug(`Counter value is now`, counter);
    },
  },
];

const logger = createSimpleLogger(); // SimpleLogger is a console logger
// Configure the server
rxpress.init({
  config: {
    port: 3000, // serve on port 3000
    loadEnv: true, // auto-load discovered .env files
  },
  logger,
  kv: createMemoryKv('example-app'), // In-memory Key-Value storage
});

// Wire-up the server
rxpress.addHandlers(routes);
rxpress.addEvents(events);

// Start the server
rxpress.start().catch(async (e) => {
  await rxpress.stop(true);
});
```
