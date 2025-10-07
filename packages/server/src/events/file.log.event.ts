import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ConfigService, EventConfig } from 'rxpress';

const filename = ConfigService.resolveFromRootDir(`logs`, 'app.log');
mkdirSync(dirname(filename), {recursive: true});

export default {
    subscribe: ['do-log'],
    handler: async function(input, {logger}) {
        logger.debug(`do-log event handler called - writing log to ${filename}`)
        const {level, time, msg, meta} = input as Record<string, any>;
        appendFileSync(filename, JSON.stringify({time, level, msg, meta}, null, 2));
    }
} as EventConfig;