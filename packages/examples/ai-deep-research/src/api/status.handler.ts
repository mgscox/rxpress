import type { RPCConfig } from 'rxpress';
import { z } from 'zod';

import { computeProgress, getJob } from '../services/job-store.js';

const responseSchema = z.object({
  jobId: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  query: z.string(),
  breadth: z.number(),
  depth: z.number(),
  progress: z.object({
    currentDepth: z.number(),
    totalDepth: z.number(),
    percentComplete: z.number()
  }),
  reportAvailable: z.boolean(),
  error: z.string().optional()
});

const handler: RPCConfig = {
  type: 'api',
  method: 'GET',
  path: '/api/research/:id/status',
  name: 'Research status',
  description: 'Retrieve job status and progress information',
  responseSchema: { 200: responseSchema as unknown as any },
  handler: async (req, { kv, logger }) => {
    try {
      const jobId = req.params.id;
      const job = jobId ? await getJob(kv, jobId) : undefined;

      if (!job) {
        return {
          status: 404,
          body: {
            message: 'Research job not found',
            jobId
          }
        };
      }

      return {
        status: 200,
        body: {
          jobId,
          status: job.status,
          query: job.query,
          breadth: job.breadth,
          depth: job.depth,
          progress: computeProgress(job),
          reportAvailable: Boolean(job.report),
          error: job.error
        }
      };
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to read job status';
      logger.error('Failed to read job status', { error: message });
      return {
        status: 500,
        body: {
          message
        }
      };
    }
  }
};

export default handler;
