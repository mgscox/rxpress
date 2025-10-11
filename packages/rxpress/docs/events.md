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

Event handlers receive:

- `trigger`: topic name
- `logger`
- `kv`
- `emit`: emit additional events

Because handlers run on RxJS observables you can fan-out, buffer, or throttle streams with custom operators if desired.

## Best Practices

- **Keep handlers idempotent.** They may be triggered from cron jobs or retries.
- **Emit domain events, not implementation details.** For example `orders::created` rather than `sql::inserted`.
- **Leverage adapters.** Use the provided `logger` and `kv` instances so that tests can inject in-memory substitutes.

See [`packages/rxpress/__tests__/rxpress.integration.test.ts`](../__tests__/rxpress.integration.test.ts) for an end-to-end example that asserts emitted events.
