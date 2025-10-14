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

export default {
  type: 'api',
  method: 'POST',
  path: '/chat',
  bodySchema: chatRequestSchema,
  handler: async (req, { logger }) => {
    const { prompt, history = [], model } = req.body as ChatRequest;
    const endpointBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const chatEndpoint = endpointBase + '/chat/completions';
    const payload = {
      model: model ?? process.env.OPENAI_MODEL ?? 'gpt-5-nano',
      stream: false,
      messages: [
        ...history.map(({ role, content }) => ({ role, content })),
        { role: 'user', content: prompt },
      ],
    };

    let response: Response;

    try {
      response = await fetch(chatEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(payload),
      });
    }
    catch (error) {
      logger.error('Failed to reach OpenAI endpoint', {
        endpoint: chatEndpoint,
        error: `${error}`,
      });
      return {
        status: 502,
        body: { ok: false, error: 'OpenAI_unreachable', detail: `${error}` },
      };
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      logger.error('OpenAI request failed', { status: response.status, body: errorText });
      return {
        status: 502,
        body: { ok: false, error: 'OpenAI_request_failed', detail: errorText },
      };
    }

    const data = await response.json().catch(() => null);

    if (!data) {
      logger.error('OpenAI returned invalid JSON');
      return {
        status: 502,
        body: { ok: false, error: 'OpenAI_invalid_response' },
      };
    }

    const outputText = data.choices?.[0]?.message?.content ?? '';
    const ok = outputText.length;

    return {
      status: ok ? 200 : 400,
      body: {
        ok,
        output: outputText,
        raw: data,
      },
    };
  },
} as RPCConfig;
