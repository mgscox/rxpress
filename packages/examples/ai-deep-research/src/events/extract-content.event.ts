import { z } from 'zod';
import type { EventConfig } from 'rxpress';

import { FirecrawlService } from '../services/firecrawl.service.js';
import type { SearchCompletedEvent } from '../types/events.js';
import { getJob, setJobStatus } from '../services/job-store.js';

const payloadSchema = z.object({
  jobId: z.string(),
  depth: z.number().int().min(0),
  originalQuery: z.string().min(1),
  results: z.array(
    z.object({
      query: z.string(),
      results: z.array(
        z.object({
          url: z.string().url().or(z.string().min(1)),
          title: z.string(),
          snippet: z.string().optional()
        })
      )
    })
  )
});

const extractKey = (jobId: string, depth: number) => `research:extract:${jobId}:${depth}`;

export default {
  name: 'Extract page content',
  description: 'Pull detailed content for search results',
  subscribe: ['research.search.completed'],
  emits: ['research.content.extracted'],
  strict: true,
  schema: payloadSchema as unknown as any,
  handler: async (input, { logger, kv, emit }) => {
    try {
      const job = await getJob(kv, input.jobId);

      if (!job) {
        throw new Error(`Job ${input.jobId} missing before extraction`);
      }

      const firecrawl = new FirecrawlService();
      const queue = input.results.flatMap((bucket) =>
        bucket.results.map((result) => ({
          url: result.url,
          title: result.title,
          query: bucket.query
        }))
      );

      const extracted = await firecrawl.extractContents(queue, logger);
      await kv.set(extractKey(input.jobId, input.depth), extracted);

      await emit({
        topic: 'research.content.extracted',
        data: {
          jobId: input.jobId,
          depth: input.depth,
          originalQuery: input.originalQuery,
          extracted
        }
      });
    }
    catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      logger.error('Failed to extract web content', { jobId: input.jobId, error: message });
      await setJobStatus(kv, input.jobId, 'failed', message);
    }
  }
} satisfies EventConfig<SearchCompletedEvent>;
