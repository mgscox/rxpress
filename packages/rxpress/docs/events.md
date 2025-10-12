# Events

The event bus is the heart of `rxpress`. Every request context includes an `emit` helper so that handlers can broadcast data decoupled from the original HTTP response.

## Emitting & Subscribing

```ts
const routes: RPCConfig[] = [
  {
    type: 'api',
    method: 'POST',
    path: '/orders',
    handler: async (req, { emit, kv }) => {
      const order = await saveOrder(req.body);
      kv.set(`order:${order.id}`, order);
      emit({ topic: 'orders::created', data: order });
      return { status: 201, body: order };
    },
  },
];

const events: EventConfig[] = [
  {
    subscribe: ['orders::created'],
    handler: async (order, { logger }) => {
      logger.info('Order created', order as Record<string, unknown>);
    },
  },
  {
    subscribe: ['orders::created'],
    handler: async (order, { emit }) => {
      emit({ topic: 'billing::invoice', data: order });
    },
  },
];
```

If you need runtime validation of the payload, supply a Zod schema and the handler receives the parsed object. Additionally, if you set `strict: true` an error is logged and the event is skipped should validation fail:

```ts
import * as z from 'zod';

const orderSchema = z.object({ id: z.string(), total: z.number() });

const events: EventConfig<z.infer<typeof orderSchema>>[] = [
  {
    subscribe: ['orders::created'],
    strict: true,
    schema: orderSchema,
    handler: async (order, { logger }) => {
      logger.info('Validated order created', order);
    },
  },
];
```

Event handlers receive:

- `trigger`: topic name which initiated this event
- `logger`
- `kv` / `kvPath`: persistent storage adapters (direct key lookup + dot-path helpers)
- `run`: run-scoped store that is cleared automatically when flow completes
- `emit`: emit additional events

Because handlers run on RxJS observables you can fan-out, buffer, or throttle streams with custom operators if desired.

## Best Practices

- **Keep handlers idempotent.** They may be triggered from cron jobs or retries.
- **Emit domain events, not implementation details.** For example `orders::created` rather than `sql::inserted`.
- **Leverage adapters.** Use the provided `logger` and `kv` instances so that tests can inject in-memory substitutes.
- **Register emitters.** Populate the `emits` array on routes and cron jobs so `rxpress` can validate that every topic has a matching subscriber.
- **Enable strict validation for shared contracts.** Provide a Zod schema + `strict: true` to reject malformed payloads early; optional schemas without `strict` still attempt parsing but fall back to the original data on failure.

See [`packages/rxpress/__tests__/rxpress.integration.test.ts`](../__tests__/rxpress.integration.test.ts) for an end-to-end example that asserts emitted events.
