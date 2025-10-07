import chalk from 'chalk';
import { createInterface } from 'node:readline';
import { EventConfig } from 'rxpress';

const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
});

const levelTags = {
  error: chalk.red('[ERROR]'),
  info: chalk.blue('[INFO]'),
  warn: chalk.yellow('[WARN]'),
  debug: chalk.gray('[DEBUG]'),
  trace: chalk.gray('[TRACE]'),
}

export default {
    subscribe: ['do-log'],
    handler: async function(input, {logger}) {
        logger.debug(`do-log event handler called`)
        const {level, time, msg, meta} = input as Record<string, any>;
        const levelKey = level.toLowerCase() as keyof typeof levelTags;
        const tag = levelTags[levelKey] || '[LOG]';
        rl.write(
            `${tag} [${new Date(time).toLocaleString()}] - ${msg} ${meta ? JSON.stringify(meta) : ''}\n`
        )
    }
} as EventConfig;