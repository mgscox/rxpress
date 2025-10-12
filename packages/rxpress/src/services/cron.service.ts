import { CronJob } from 'cron';
import { SpanStatusCode } from '@opentelemetry/api';

import { CronConfig } from '../types/cron.types.js';
import { KVBase } from '../types/kv.types.js';
import { Logger } from '../types/logger.types.js';
import { EventService } from './event.service.js';
import { createRun as createRunScope, releaseRun as releaseRunScope } from './run.service.js';
import { createKVPath } from './kv-path.service.js';
import { MetricService } from './metrics.service.js';

export namespace CronService {
  const jobs: CronJob[] = [];

  async function executeWithRetry(cron: CronConfig, ctx: { logger: Logger; kv: KVBase }) {
    const {
      retry: {
        maxRetries = 0,
        delayMs = 1000,
      } = {},
    } = cron;

    let attempt = 0;

    const tracer = MetricService.getTracer();

    let shouldTerminate = false;

    while (!shouldTerminate) {
      await tracer.startActiveSpan(`cron ${cron.cronTime}`, { attributes: {
        'rxpress.cron.schedule': cron.cronTime,
        'rxpress.cron.name': cron.handler.name || 'cron-handler',
      } }, async (span) => {
        const run = await createRunScope(ctx.kv);
        const kvPath = createKVPath(ctx.kv);
        const emitWithRun = (param: { topic: string; data?: unknown }) => EventService.emit({ ...param, run, traceContext: span.spanContext() });

        try {
          const result = await cron.handler(Date.now(), {
            logger: ctx.logger,
            kv: ctx.kv,
            kvPath,
            emit: emitWithRun,
            run,
          });

          if (result && typeof result === 'object' && 'retryMs' in result && result.retryMs && attempt <= maxRetries) {
            attempt += 1;
            span.setStatus({ code: SpanStatusCode.OK });
            await new Promise((resolve) => setTimeout(resolve, result.retryMs));
            return;
          }

          span.setStatus({ code: SpanStatusCode.OK });
          shouldTerminate = true;
        }
        catch (error) {
          ctx.logger.error?.('Cron handler failed', { error: `${error}`, cron: cron.cronTime, attempt });
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message: `${error}` });

          if (attempt >= maxRetries) {
            shouldTerminate = true;
          }
          else {
            attempt += 1;
            const wait = Math.max(delayMs, 0);
            await new Promise((resolve) => setTimeout(resolve, wait));
          }
        }
        finally {
          try {
            await releaseRunScope(run.id);
          }
          catch (releaseError) {
            ctx.logger.error?.('Failed to release cron run scope', { error: `${releaseError}`, cron: cron.cronTime });
          }

          span.end();
        }
      });
    }
  }

  export const add = (
    crons: CronConfig | CronConfig[],
    { logger, kv }: { logger: Logger; kv: KVBase },
  ) => {
    const entries = Array.isArray(crons) ? crons : [crons];

    for (const cron of entries) {
      jobs.push(
        CronJob.from({
          cronTime: cron.cronTime,
          start: true,
          timeZone: cron.timeZone,
          onTick: () => {
            void executeWithRetry(cron, { logger, kv });
          },
        }),
      );
    }
  };

  export const close = () => {
    jobs.forEach((job) => job.stop());
  };
}
