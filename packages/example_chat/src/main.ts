import readline from 'node:readline/promises';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { stdin as input, stdout as output } from 'node:process';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { rxpress, SSEChunkHandler } from 'rxpress';
import type { Logger, KVBase } from 'rxpress';
import ora from "ora";

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

    try {
      const requestHistory = [...history, { role: 'user', content: prompt }];
      const answer = await streamChat(port, {
        prompt,
        history: requestHistory,
      });

      history.push({ role: 'user', content: prompt });

      if (answer) {
        history.push({ role: 'assistant', content: answer });
      }
      else {
        console.log('[no content returned]');
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      console.error(`\nChat error: ${message}`);
    }

    process.stdout.write('\n');
    rl.prompt();
  }

  rl.close();
  await rxpress.stop().catch((error) => {
    logger.error('Error during shutdown', error);
  });
  process.exit(0);
}

async function streamChat(port: number, payload: Record<string, unknown>): Promise<string> {
  let prefix = 'assistant> ';
  let reply = '';
  const spinner = ora({ text: 'Thinking ', spinner: 'dots', discardStdin: false }).start();

  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const handler = await SSEChunkHandler({logger});
  return new Promise(resolve => {
    handler.on('delta', (delta) => {
      spinner.stop();
      const chunk = (delta.choices?.[0]?.delta?.content || '');
      process.stdout.write(prefix + chunk);
      reply += chunk;
      prefix = '';
    });
    handler.on('complete', (_message) => {
      spinner.stop();
      resolve(reply);
    })
    handler.run(response.body as NodeReadableStream<Uint8Array>)
  })
}

dotenv.config({ 
  path: resolve(process.cwd(), '.env'), 
  encoding: 'utf-8', 
});

bootstrap().catch((error) => {
  logger.error('Failed to start example chat', {error});
  process.exitCode = 1;
});
