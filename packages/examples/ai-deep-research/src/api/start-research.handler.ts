import type { RPCConfig } from 'rxpress';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';

import { computeProgress, createJob, ensureJob } from '../services/job-store.js';
import type { ResearchStartedEvent } from '../types/events.js';

const MIN_BREADTH = 1;
const MAX_BREADTH = 10;
const MIN_DEPTH = 1;
const MAX_DEPTH = 5;

const bodySchema = z.object({
  query: z.string().min(1, 'query is required'),
  breadth: z.number().int().min(MIN_BREADTH).max(MAX_BREADTH).default(4),
  depth: z.number().int().min(MIN_DEPTH).max(MAX_DEPTH).default(2)
});

const responseSchema = z.object({
  jobId: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  progress: z.object({
    currentDepth: z.number(),
    totalDepth: z.number(),
    percentComplete: z.number()
  })
});

const handler: RPCConfig = {
  type: 'api',
  method: 'POST',
  path: '/api/research',
  name: 'Start research request',
  description: 'Kick off a deep research job',
  bodySchema: bodySchema as unknown as any,
  responseSchema: { 202: responseSchema as unknown as any },
  emits: ['research.start'],
  handler: async (req, { emit, kv, logger }) => {
    try {
      const parsed = bodySchema.parse(req.body ?? {});
      const jobId = uuid();
      const job = createJob(jobId, parsed);
      await ensureJob(kv, job);

      logger.info('Research job created', { jobId, query: parsed.query });

      const eventPayload: ResearchStartedEvent = {
        jobId,
        query: parsed.query,
        breadth: parsed.breadth,
        depth: parsed.depth
      };

      await emit({ topic: 'research.start', data: eventPayload });

      return {
        status: 202,
        body: {
          jobId,
          status: job.status,
          progress: computeProgress(job)
        }
      };
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start research job';
      const isValidation = error instanceof z.ZodError;
      logger.error('Failed to start research job', { error: message });
      return {
        status: isValidation ? 400 : 500,
        body: {
          message
        }
      };
    }
  }
};

export default handler;
