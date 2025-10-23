import type { RPCConfig } from 'rxpress';
import { z } from 'zod';

import { getJob } from '../services/job-store.js';

const reportSectionSchema = z.object({
  title: z.string(),
  content: z.string()
});

const reportSchema = z.object({
  title: z.string(),
  overview: z.string(),
  sections: z.array(reportSectionSchema),
  keyTakeaways: z.array(z.string()),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
  originalQuery: z.string(),
  metadata: z.object({
    depthUsed: z.number(),
    completedAt: z.string()
  })
});

const responseWrapperSchema = z.object({ report: reportSchema });

const handler: RPCConfig = {
  type: 'api',
  method: 'GET',
  path: '/api/research/:id/report',
  name: 'Research report',
  description: 'Return the compiled research report for a job',
  responseSchema: { 200: responseWrapperSchema as unknown as any },
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

      if (!job.report) {
        return {
          status: 404,
          body: {
            message: 'Research report not ready',
            jobId
          }
        };
      }

      return {
        status: 200,
        body: {
          report: job.report
        }
      };
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load research report';
      logger.error('Failed to load research report', { error: message });
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
