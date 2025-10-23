import type { RPCConfig } from 'rxpress';
import { z } from 'zod';

const bodySchema = z.object({
  text: z.string().min(1, 'text is required'),
  language: z.string().optional(),
});

const handler: RPCConfig = {
  type: 'api',
  method: 'POST',
  path: '/api/sentiment',
  name: 'Sentiment (Python gRPC)',
  description: 'Delegates sentiment analysis to the Python gRPC bridge',
  bodySchema: bodySchema as any,
  kind: 'grpc',
  grpc: {
    handlerName: 'sentiment.analyse',
    service: 'python-sentiment',
    timeoutMs: 10_000,
  },
};

export default handler;
