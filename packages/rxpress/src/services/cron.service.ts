import { CronJob } from 'cron';

import { CronConfig } from '../types/cron.types.js';
import { KVBase } from '../types/kv.types.js';
import { Logger } from '../types/logger.types.js';
import { EventService } from './event.service.js';
import { createRun as createRunScope, releaseRun as releaseRunScope } from './run.service.js';
import { createKVPath } from './kv-path.service.js';

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

    while (true) {
      const run = await createRunScope(ctx.kv);
      const kvPath = createKVPath(ctx.kv);
      const emitWithRun = (param: { topic: string; data?: unknown }) => EventService.emit({ ...param, run });

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
          await new Promise((resolve) => setTimeout(resolve, result.retryMs));
          continue;
        }

        break;
      }
      catch (error) {
        ctx.logger.error?.('Cron handler failed', { error: `${error}`, cron: cron.cronTime, attempt });

        if (attempt >= maxRetries) {
          break;
        }

        attempt += 1;
        const wait = Math.max(delayMs, 0);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      finally {
        try {
          await releaseRunScope(run.id);
        }
        catch (releaseError) {
          ctx.logger.error?.('Failed to release cron run scope', { error: `${releaseError}`, cron: cron.cronTime });
        }
      }
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
