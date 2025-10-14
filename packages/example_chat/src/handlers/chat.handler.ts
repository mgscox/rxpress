import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { z } from 'zod';
import type { RPCConfig } from 'rxpress';

const chatRequestSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .optional(),
});

type ChatRequest = z.infer<typeof chatRequestSchema>;

const streamChunkSchema = z.object({
  id: z.string(),
  object: z.string(),
  created: z.number(),
  model: z.string(),
  system_fingerprint: z.string().nullable().optional(),
  choices: z.array(
    z.object({
      index: z.number(),
      delta: z.object({
        role: z.string().optional(),
        content: z.string().optional(),
      }),
      logprobs: z.any().nullable().optional(),
      finish_reason: z.string().nullable().optional(),
    }),
  ),
});

const getClient = (() => {
  let client: OpenAI | null = null;

  return () => {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not defined');
    }

    if (!client) {
      client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
      });
    }

    return client;
  };
})();

export default {
  type: 'sse',
  method: 'POST',
  path: '/chat',
  bodySchema: chatRequestSchema,
  responseSchema: streamChunkSchema,
  handler: async (req, { logger, stream }) => {
    let client: OpenAI;

    try {
      client = getClient();
    }
    catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      logger.error('OpenAI client initialisation failed', { message });
      stream.error(message);
      return;
    }

    const { prompt, history = [], model } = req.body as ChatRequest;
    const messages: ChatCompletionMessageParam[] = [
      ...history.map(({ role, content }) => ({ role, content } as ChatCompletionMessageParam)),
      { role: 'user', content: prompt },
    ];
    const chosenModel = model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

    try {
      const completion = await client.chat.completions.create({
        model: chosenModel,
        messages,
        stream: true,
      });

      for await (const chunk of completion) {
        stream.send(chunk);
      }

    }
    catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      logger.error('OpenAI streaming request failed', { message });
      stream.error(message);
    }
  },
} as RPCConfig;
