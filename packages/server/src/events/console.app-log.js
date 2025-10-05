import { LogData } from "../services/logger.service";
import { EventConfig } from "../types";

export default {
    subscribe: ['app::log'],
    handler: async function(input) {
        const {level, time, msg, meta} = input;
        process.stdout.write(`[${level}] ${time} - ${msg} ${meta ? JSON.stringify(meta, null, 2) : ''}\n`);
    }
};