import { Emit } from './emit.types.js';
import { KVBase } from './kv.types.js';
import { Logger } from './logger.types.js';

export type CronHandler = (now: number, ctx: { logger: Logger; kv: KVBase; emit: Emit }) => void;

export type CronConfig = {
  cronTime: string;
  timeZone?: string;
  handler: CronHandler;
};
