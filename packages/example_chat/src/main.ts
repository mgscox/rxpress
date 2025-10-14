import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { rxpress } from 'rxpress';
import type { Logger, KVBase } from 'rxpress';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const logger: Logger = {
  child: () => logger,
  info: (msg, meta) => console.log('[info]', msg, meta ?? ''),
  error: (msg, meta) => console.error('[error]', msg, meta ?? ''),
  debug: (msg, meta) => console.debug('[debug]', msg, meta ?? ''),
  warn: (msg, meta) => console.warn('[warn]', msg, meta ?? ''),
  log: (payload) => console.log(payload),
  addListener: () => undefined,
};

const kvStore = new Map<string, unknown>();
const kv: KVBase = {
  set: (key, value) => {
    kvStore.set(key, value);
  },
  get: async <T>(key: string) => kvStore.get(key) as T | undefined,
  has: (key) => kvStore.has(key),
  del: (key) => {
    kvStore.delete(key);
  },
};

async function bootstrap() {
  rxpress.init({
    config: {
      loadEnv: false,
    },
    logger,
    kv,
  });

  await rxpress.load({
    handlerDir: new URL('./handlers', import.meta.url).pathname,
  });

  const { port } = await rxpress.start({ port: Number(process.env.PORT) || 3000 });
  console.log(`rxpress chat server listening on http://127.0.0.1:${port}`);

  await startCli(port);
}

async function startCli(port: number) {
  const rl = readline.createInterface({ input, output, prompt: 'you> ' });
  const history: ChatMessage[] = [];

  console.log('Type messages to chat with the model. Type "exit" to quit.');
  rl.prompt();

  for await (const line of rl) {
    const prompt = line.trim();

    if (!prompt) {
      rl.prompt();
      continue;
    }

    if (prompt.toLowerCase() === 'exit') {
      break;
    }

    history.push({ role: 'user', content: prompt });

    const response = await fetch(`http://127.0.0.1:${port}/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prompt, history }),
    });

    if (!response.ok) {
      console.error('Request failed', await response.text());
      rl.prompt();
      continue;
    }

    const payload = await response.json();

    if (!payload.ok) {
      console.error('Chat error', payload.detail ?? payload.error);
      rl.prompt();
      continue;
    }

    const answer: string = payload.output ?? '';
    history.push({ role: 'assistant', content: answer });
    console.log(`assistant> ${answer}`);
    rl.prompt();
  }

  rl.close();
  await rxpress.stop().catch((error) => {
    logger.error('Error during shutdown', error);
  });
  process.exit(0);
}

dotenv.config({ path: resolve(process.cwd(), '.env'), encoding: 'utf-8', debug: true });

bootstrap().catch((error) => {
  logger.error('Failed to start example chat', error);
  process.exit(1);
});
