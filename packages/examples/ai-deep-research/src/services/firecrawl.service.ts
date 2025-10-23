import FirecrawlApp from '@mendable/firecrawl-js';
import type { Logger } from 'rxpress';

import type { ExtractedContent, SearchResultItem } from '../types/research.js';

type FirecrawlSearchResponse = {
  success: boolean;
  data?: Array<{ url?: string; title?: string; description?: string }>;
  error?: string;
};

type FirecrawlScrapeResponse = {
  success: boolean;
  markdown?: string;
  error?: string;
};

export class FirecrawlService {
  private readonly client: FirecrawlApp;
  private readonly concurrency: number;
  private readonly batchDelayMs: number;
  private readonly maxAttempts: number;

  constructor(apiKey = process.env.FIRECRAWL_API_KEY, apiUrl = process.env.FIRECRAWL_API_URL) {
    if (!apiKey) {
      throw new Error('FIRECRAWL_API_KEY is required to run the research pipeline');
    }

    this.client = new FirecrawlApp({ apiKey, apiUrl: apiUrl ?? null });
    this.concurrency = Number.parseInt(process.env.FIRECRAWL_CONCURRENCY_LIMIT || '2', 10);
    this.batchDelayMs = Number.parseInt(process.env.FIRECRAWL_BATCH_DELAY_MS || '2000', 10);
    this.maxAttempts = Math.max(1, Number.parseInt(process.env.FIRECRAWL_MAX_RETRIES || '3', 10));
  }

  async search(query: string, logger?: Logger): Promise<SearchResultItem[]> {
    logger?.info('firecrawl.search', { query });
    const response = await this.withRetry<FirecrawlSearchResponse>(() => this.client.search(query), logger, {
      operation: 'search',
      query
    });

    if (!response.success) {
      const detail = response.error || 'unknown error';
      throw new Error(`Firecrawl search failed: ${detail}`);
    }

    return (response.data || []).map((item) => ({
      url: item.url ?? '',
      title: item.title ?? '',
      snippet: item.description ?? ''
    }));
  }

  async extractContents(
    entries: { url: string; title: string; query: string }[],
    logger?: Logger
  ): Promise<ExtractedContent[]> {
    const batches = this.partition(entries, Math.max(this.concurrency, 1));
    const collected: ExtractedContent[] = [];

    for (const batch of batches) {
      const results = await Promise.all(batch.map(async ({ url, title, query }) => {
        try {
          const scraped = await this.withRetry<FirecrawlScrapeResponse>(
            () => this.client.scrapeUrl(url, { formats: ['markdown'] }),
            logger,
            { operation: 'scrape', url }
          );

          if (!scraped.success) {
            throw new Error(scraped.error || 'unknown error');
          }

          const content = scraped.markdown || '';
          logger?.debug('firecrawl.extract.success', { url, length: content.length });
          return { url, title, query, content } satisfies ExtractedContent;
        }
        catch (error) {
          const message = error instanceof Error ? error.message : `${error}`;
          logger?.warn('firecrawl.extract.error', { url, error: message });
          return null;
        }
      }));

      collected.push(...results.filter(Boolean) as ExtractedContent[]);

      if (this.batchDelayMs > 0 && batch !== batches[batches.length - 1]) {
        await new Promise((resolve) => setTimeout(resolve, this.batchDelayMs));
      }
    }

    return collected;
  }

  private partition<T>(items: T[], size: number): T[][] {
    const result: T[][] = [];

    for (let i = 0; i < items.length; i += size) {
      result.push(items.slice(i, i + size));
    }

    return result;
  }

  private async withRetry<T>(operation: () => Promise<T>, logger?: Logger, meta?: Record<string, unknown>): Promise<T> {
    let attempt = 0;

    while (attempt < this.maxAttempts) {
      attempt += 1;

      try {
        return await operation();
      }
      catch (error) {
        if (attempt >= this.maxAttempts) {
          throw error;
        }

        const delay = this.computeDelay(attempt);
        const context = { attempt, delay, ...(meta || {}) };
        logger?.warn('firecrawl.retry', context);
        await this.wait(delay);
      }
    }

    throw new Error('Retry logic exhausted without executing operation');
  }

  private computeDelay(attempt: number): number {
    const base = 500;
    return base * attempt;
  }

  private async wait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
