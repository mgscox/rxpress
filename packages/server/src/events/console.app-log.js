import chalk from 'chalk';

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
        process.stdout.write(
            `${tag} [${new Date(time).toLocaleString()} - ${msg} ${meta ? JSON.stringify(meta) : ''}\n`
        )
    }
};