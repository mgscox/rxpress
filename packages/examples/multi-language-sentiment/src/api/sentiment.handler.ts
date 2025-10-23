import type { RPCConfig } from 'rxpress';
import { z } from 'zod';

import { analyseSentiment } from '../services/sentiment-client.js';

const bodySchema = z.object({
  text: z.string().min(1, 'text is required'),
  language: z.string().optional(),
});

const handler: RPCConfig = {
  type: 'api',
  method: 'POST',
  path: '/api/sentiment',
  name: 'Sentiment (gRPC)',
  description: 'Forward sentiment requests to the Python gRPC service',
  bodySchema: bodySchema as any,
  handler: async (req) => {
    const parsed = bodySchema.parse(req.body ?? {});
    const result = await analyseSentiment(parsed.text, parsed.language);

    return {
      status: 200,
      body: {
        text: parsed.text,
        language: parsed.language ?? null,
        response: result,
      },
    };
  },
};

export default handler;
