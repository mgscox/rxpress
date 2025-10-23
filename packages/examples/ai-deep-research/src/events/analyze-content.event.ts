import { z } from 'zod';
import type { EventConfig } from 'rxpress';

import { OpenAIService } from '../services/openai.service.js';
import type { ContentExtractedEvent } from '../types/events.js';
import { getJob, recordAnalysis, setJobStatus } from '../services/job-store.js';

const payloadSchema = z.object({
  jobId: z.string(),
  depth: z.number().int().min(0),
  originalQuery: z.string().min(1),
  extracted: z.array(
    z.object({
      url: z.string().min(1),
      title: z.string().min(1),
      content: z.string(),
      query: z.string().min(1)
    })
  )
});

export default {
  name: 'Analyze extracted content',
  description: 'Use OpenAI to produce summaries and key findings',
  subscribe: ['research.content.extracted'],
  emits: ['research.followup.required', 'research.analysis.completed'],
  strict: true,
  schema: payloadSchema as unknown as any,
  handler: async (input, { logger, kv, emit }) => {
    try {
      const job = await getJob(kv, input.jobId);

      if (!job) {
        throw new Error(`Job ${input.jobId} missing before analysis`);
      }

      const openai = new OpenAIService();
      const analysis = await openai.analyzeContent(
        input.originalQuery,
        input.extracted,
        input.depth,
        job.depth
      );

      await recordAnalysis(kv, input.jobId, analysis);

      const nextDepth = input.depth + 1;
      const hasFollowUps = Array.isArray(analysis.followUpQueries) && analysis.followUpQueries.length > 0;
      const canContinue = nextDepth < job.depth;

      logger.info('Analysis completed', {
        jobId: input.jobId,
        depth: input.depth,
        followUps: hasFollowUps ? analysis.followUpQueries?.length : 0
      });

      if (hasFollowUps && canContinue) {
        await emit({
          topic: 'research.followup.required',
          data: {
            jobId: input.jobId,
            depth: nextDepth,
            originalQuery: input.originalQuery,
            queries: analysis.followUpQueries || []
          }
        });
        return;
      }

      await emit({
        topic: 'research.analysis.completed',
        data: {
          jobId: input.jobId,
          depth: input.depth,
          analysis,
          isFinal: true
        }
      });
    }
    catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      logger.error('Failed to analyze content', { jobId: input.jobId, error: message });
      await setJobStatus(kv, input.jobId, 'failed', message);
    }
  }
} satisfies EventConfig<ContentExtractedEvent>;
