import chalk from 'chalk';
import { createInterface } from 'node:readline';

const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    error: process.stdout,
    tabSize: 4,
    prompt: '',
    removeHistoryDuplicates: true,
    historySize: 10,
    terminal: true,
    escapeCodeTimeout: 10,
    tabCompletion: true,
    history: [],
});

const levelTags = {
  error: chalk.red('[ERROR]'),
  info: chalk.blue('[INFO]'),
  warn: chalk.yellow('[WARN]'),
  debug: chalk.gray('[DEBUG]'),
  trace: chalk.gray('[TRACE]'),
}

export default {
    subscribe: ['app::log'],
    handler: async function(input) {
        const {level, time, msg, meta} = input;
        const tag = levelTags[level.toLowerCase()] || '[LOG]';
        rl.write(
            `${tag} [${new Date(time).toLocaleString()} - ${msg} ${meta ? JSON.stringify(meta) : ''}\n`
        )
    }
};