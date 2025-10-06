import { CronJob } from 'cron';

import { CronConfig } from "../types/cron.types";
import { KVBase } from "../types/kv.types";
import { Logger } from "../types/logger.types";
import { EventService } from '../services/event.service'

export namespace CronService {
    const jobs: CronJob[] = [];
    export const add = (crons: CronConfig | CronConfig[], {logger, kv}: {logger: Logger, kv: KVBase}) => {
        if (!Array.isArray(crons)) {
            crons = [crons];
        }
        for (const cron of crons) {
            jobs.push(CronJob.from({
                cronTime: cron.cronTime,
                start: true,
                timeZone: cron.timeZone,
                onTick: () => {
                    cron.handler(Date.now(),{logger, kv, emit: EventService.emit})
                }
            }));
        }
    }
    export const close = () => {
        jobs.forEach(job => job.stop());
    }
}