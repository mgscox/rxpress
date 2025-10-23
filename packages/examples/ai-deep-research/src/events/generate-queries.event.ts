import { z } from 'zod';
import type { EventConfig } from 'rxpress';

import { OpenAIService } from '../services/openai.service.js';
import type { ResearchStartedEvent } from '../types/events.js';
import { getJob, saveJob, setJobStatus } from '../services/job-store.js';

const payloadSchema = z.object({
  jobId: z.string(),
  query: z.string().min(1),
  breadth: z.number().int().min(1),
  depth: z.number().int().min(1)
});

export default {
  name: 'Generate search queries',
  description: 'Initial query generation via OpenAI',
  subscribe: ['research.start'],
  emits: ['research.queries.generated'],
  strict: true,
  schema: payloadSchema as unknown as any,
  handler: async (input, { logger, kv, emit }) => {
    try {
      const job = await getJob(kv, input.jobId);

      if (!job) {
        throw new Error(`Job ${input.jobId} missing before query generation`);
      }

      job.status = 'running';
      job.currentDepth = 0;
      await saveJob(kv, job);

      const openai = new OpenAIService();
      const queries = await openai.generateQueries(input.query, input.breadth);

      logger.info('Generated search queries', { jobId: input.jobId, count: queries.length });

      await emit({
        topic: 'research.queries.generated',
        data: {
          jobId: input.jobId,
          depth: 0,
          queries,
          originalQuery: input.query
        }
      });
    }
    catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      logger.error('Failed to generate queries', { jobId: input.jobId, error: message });
      await setJobStatus(kv, input.jobId, 'failed', message);
    }
  }
} satisfies EventConfig<ResearchStartedEvent>;
