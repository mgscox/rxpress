import { z } from 'zod';
import type { EventConfig } from 'rxpress';

import { OpenAIService } from '../services/openai.service.js';
import type { AnalysisCompletedEvent } from '../types/events.js';
import { attachReport, getJob, setJobStatus } from '../services/job-store.js';

const payloadSchema = z.object({
  jobId: z.string(),
  depth: z.number().int().min(0),
  isFinal: z.boolean(),
  analysis: z.object({
    depth: z.number().int().min(0),
    summary: z.string(),
    keyFindings: z.array(z.string()),
    sources: z.array(z.object({ title: z.string(), url: z.string().min(1) })),
    followUpQueries: z.array(z.string()).optional()
  })
});

export default {
  name: 'Compile final report',
  description: 'Combine analysis outputs into a final research report',
  subscribe: ['research.analysis.completed'],
  strict: true,
  schema: payloadSchema as unknown as any,
  handler: async (input, { logger, kv }) => {
    if (!input.isFinal) {
      return;
    }

    try {
      const job = await getJob(kv, input.jobId);

      if (!job) {
        throw new Error(`Job ${input.jobId} missing before report compilation`);
      }

      const analyses = Object.values(job.analyses).sort((a, b) => a.depth - b.depth);
      const openai = new OpenAIService();
      const report = await openai.compileReport(job.query, analyses);
      const normalizedReport = {
        ...report,
        metadata: {
          ...report.metadata,
          depthUsed: analyses.length
        }
      };

      await attachReport(kv, input.jobId, normalizedReport);

      logger.info('Final report compiled', { jobId: input.jobId, depthUsed: normalizedReport.metadata.depthUsed });

    }
    catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      logger.error('Failed to compile final report', { jobId: input.jobId, error: message });
      await setJobStatus(kv, input.jobId, 'failed', message);
    }
  }
} satisfies EventConfig<AnalysisCompletedEvent>;
