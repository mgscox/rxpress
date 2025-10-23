import { z } from 'zod';
import type { EventConfig } from 'rxpress';

import { FirecrawlService } from '../services/firecrawl.service.js';
import type { QueriesGeneratedEvent } from '../types/events.js';
import { getJob, setJobStatus } from '../services/job-store.js';

const payloadSchema = z.object({
  jobId: z.string(),
  depth: z.number().int().min(0),
  queries: z.array(z.string().min(1)),
  originalQuery: z.string().min(1)
});

const searchKey = (jobId: string, depth: number) => `research:search:${jobId}:${depth}`;

export default {
  name: 'Execute web search',
  description: 'Search the web for generated queries',
  subscribe: ['research.queries.generated'],
  emits: ['research.search.completed'],
  strict: true,
  schema: payloadSchema as unknown as any,
  handler: async (input, { logger, kv, emit }) => {
    try {
      const job = await getJob(kv, input.jobId);

      if (!job) {
        throw new Error(`Job ${input.jobId} missing before web search`);
      }

      const firecrawl = new FirecrawlService();
      const collected = [] as { query: string; results: { url: string; title: string; snippet: string }[] }[];

      for (const query of input.queries) {
        try {
          const searchResults = await firecrawl.search(query, logger);
          collected.push({ query, results: searchResults });
        }
        catch (error) {
          const message = error instanceof Error ? error.message : `${error}`;
          logger.warn('Search query failed', { jobId: input.jobId, query, error: message });
        }
      }

      await kv.set(searchKey(input.jobId, input.depth), collected);

      await emit({
        topic: 'research.search.completed',
        data: {
          jobId: input.jobId,
          depth: input.depth,
          originalQuery: input.originalQuery,
          results: collected
        }
      });
    }
    catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      logger.error('Failed to execute web search', { jobId: input.jobId, error: message });
      await setJobStatus(kv, input.jobId, 'failed', message);
    }
  }
} satisfies EventConfig<QueriesGeneratedEvent>;
