# Cron Retries

Cron jobs can automatically retry when failures occur. Configure retries per cron definition or return a hint from the handler.

```ts
const cleanupJob: CronConfig = {
  cronTime: '*/5 * * * *',
  retry: {
    maxRetries: 3,
    delayMs: 2000,
  },
  handler: async (_now, { logger }) => {
    logger.info('running cleanup');
    await removeStaleRecords();
  },
};
```

- `maxRetries` – maximum number of retry attempts after the initial execution (default: `0`).
- `delayMs` – delay between retries (default: `1000`).

If the handler throws, `rxpress` waits `delayMs`, increments the attempt counter, and reruns the cron until it succeeds or `maxRetries` is reached.

## Handler-Controlled Retry

Handlers can opt into a retry without throwing by returning `{ retryMs }`. This is useful when the operation is safe to rerun but you want to avoid raising an error.

```ts
const exportJob: CronConfig = {
  cronTime: '0 0 * * *',
  retry: {
    maxRetries: 1,
  },
  handler: async () => {
    const ready = await isExportWindowOpen();
    if (!ready) {
      return { retryMs: 5_000 }; // try again in five seconds
    }

    await runExport();
  },
};
```

A handler can combine both patterns: throw to indicate a failure, or return `{ retryMs }` when the operation should be retried gracefully.
