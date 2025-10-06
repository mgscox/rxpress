import { appendFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

import { ConfigService } from '../services/config.service.js';

const isProduction = (ConfigService.env('NODE_ENV') === 'production');
const filename = `./logs/${isProduction ? `${new Date().toISODateString()}-` : ''}app.log`
mkdirSync(dirname(filename), {recursive: true});

if (!isProduction && existsSync(filename)) {
    unlinkSync(filename);
}

export default {
    subscribe: ['app::log'],
    handler: async function(input) {
        const {level, time, msg, meta} = input;
        appendFileSync(filename, JSON.stringify({time, level, msg, meta}, null, 2));
    }
};