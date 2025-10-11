# Cron Jobs

`rxpress` schedules cron jobs with the same context used by HTTP routes: `logger`, `kv`, and `emit` are available so you can share logic across transports.

```ts
const cleanupJob: CronConfig = {
  name: 'cleanup-stale-orders',
  cronTime: '0 * * * *', // top of every hour
  retry: {
    maxRetries: 2,
    delayMs: 2000,
  },
  handler: async ({ logger, emit }) => {
    const removed = await pruneOrders();
    logger.info('Pruned stale orders', { removed });
    emit({ topic: 'orders::pruned', data: { removed } });
  },
};

rxpress.addCrons(cleanupJob);
```

Set `processHandlers: true` in `rxpress.init` to install signal handlers that stop cron jobs gracefully when the process exits.

## Retries

Cron handlers support automatic retries:

- Configure `retry.maxRetries` and `retry.delayMs` (defaults: `0` retries, `1000` ms delay) to rerun after failures.
- Return `{ retryMs }` from the handler to request another attempt without throwing.

See [Cron Retries](./cron-retries.md) for detailed behaviour and examples.

## Error Handling

When a handler throws, `rxpress` logs the error, applies the retry policy if configured, and continues with the next scheduled run. Wrap mission-critical logic in try/catch when you need custom compensating actions.

## Testing

Cron jobs are easy to test by supplying in-memory adapters, registering the cron configuration, and waiting for it to fire. The test suite includes retry scenarios in [`rxpress.cron-retry.test.ts`](../__tests__/rxpress.cron-retry.test.ts).
