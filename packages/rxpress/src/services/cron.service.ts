import { CronJob } from 'cron';

import { CronConfig } from '../types/cron.types.js';
import { KVBase } from '../types/kv.types.js';
import { Logger } from '../types/logger.types.js';
import { EventService } from './event.service.js';

export namespace CronService {
  const jobs: CronJob[] = [];

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
            cron.handler(Date.now(), { logger, kv, emit: EventService.emit });
          },
        }),
      );
    }
  };

  export const close = () => {
    jobs.forEach((job) => job.stop());
  };
}
