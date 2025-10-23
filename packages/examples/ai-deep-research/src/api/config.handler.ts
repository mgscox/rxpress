import type { RPCConfig } from 'rxpress';
import { z } from 'zod';

const configSchema = z.object({
  defaults: z.object({ breadth: z.number(), depth: z.number() }),
  limits: z.object({ breadth: z.object({ min: z.number(), max: z.number() }), depth: z.object({ min: z.number(), max: z.number() }) })
});

const handler: RPCConfig = {
  type: 'api',
  method: 'GET',
  path: '/api/research/config',
  name: 'Research configuration metadata',
  description: 'Expose UI-friendly defaults and limits for research jobs',
  responseSchema: { 200: configSchema as unknown as any },
  handler: async () => {
    const breadth = { min: 1, max: 10 };
    const depth = { min: 1, max: 5 };

    return {
      status: 200,
      body: {
        defaults: { breadth: 4, depth: 2 },
        limits: { breadth, depth }
      }
    };
  }
};

export default handler;
