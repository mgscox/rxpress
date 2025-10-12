import { Emit } from './emit.types.js';
import { KVBase, KVPath } from './kv.types.js';
import { Logger } from './logger.types.js';
import { RunContext } from './run.types.js';

export type CronHandlerResult = void | { retryMs?: number };

export type CronHandler = (
  now: number,
  ctx: { logger: Logger; kv: KVBase; kvPath: KVPath; emit: Emit; run: RunContext },
) => CronHandlerResult | Promise<CronHandlerResult>;

export type CronRetryConfig = {
  maxRetries?: number;
  delayMs?: number;
};

export type CronConfig = {
  name?: string;
  description?: string;
  cronTime: string;
  timeZone?: string;
  handler: CronHandler;
  retry?: CronRetryConfig;
  emits?: string[];
};
