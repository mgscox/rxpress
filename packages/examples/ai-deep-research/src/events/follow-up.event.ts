import { z } from 'zod';
import type { EventConfig } from 'rxpress';

import type { FollowUpRequiredEvent } from '../types/events.js';
import { getJob, setJobStatus } from '../services/job-store.js';

const payloadSchema = z.object({
  jobId: z.string(),
  depth: z.number().int().min(1),
  originalQuery: z.string().min(1),
  queries: z.array(z.string().min(1))
});

export default {
  name: 'Follow-up research dispatcher',
  description: 'Re-run search pipeline for deeper research layers',
  subscribe: ['research.followup.required'],
  emits: ['research.queries.generated'],
  strict: true,
  schema: payloadSchema as unknown as any,
  handler: async (input, { logger, kv, emit }) => {
    try {
      const job = await getJob(kv, input.jobId);

      if (!job) {
        throw new Error(`Job ${input.jobId} missing before follow-up`);
      }

      logger.info('Dispatching follow-up queries', {
        jobId: input.jobId,
        depth: input.depth,
        count: input.queries.length
      });

      await emit({
        topic: 'research.queries.generated',
        data: {
          jobId: input.jobId,
          depth: input.depth,
          queries: input.queries,
          originalQuery: input.originalQuery
        }
      });
    }
    catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      logger.error('Failed to schedule follow-up research', { jobId: input.jobId, error: message });
      await setJobStatus(kv, input.jobId, 'failed', message);
    }
  }
} satisfies EventConfig<FollowUpRequiredEvent>;
