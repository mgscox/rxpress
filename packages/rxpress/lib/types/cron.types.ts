import { Emit } from "./emit.types";
import { KVBase } from "./kv.types";
import { Logger } from "./logger.types";

export type CronFunction = (epoch: number, ctx: {logger: Logger, kv: KVBase, emit: Emit}) => Promise<void>;
export type CronConfig = {
    name: string;
    description?: string;
    cronTime: string | Date;
    timeZone?: string;
    emits?: string[];
    handler: CronFunction
}