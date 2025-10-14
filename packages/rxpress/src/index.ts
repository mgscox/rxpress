import type { Request as expressRequest } from 'express';
import { createSimpleLogger, simplelLogger } from './helpers/simple-logger.service.js';
import { createMemoryKv, MemoryKVService } from './helpers/memory-kv.service.js';
import { Logger } from './types/index.js';
import { MetricService } from './services/metrics.service.js';

// Re-export to simplofy rxpress library usage
export type Request = expressRequest;

export * from './rxpress.js';
export * from './types/index.js';
export * from './services/config.service.js';
export { SSEChunkHandler } from './services/sse.service.js';

/**
 * @example `helpers` provides example implementations - do not use for production
 */
export const helpers: {
  createSimpleLogger: () => Logger;
  simplelLogger: Logger;
  createMemoryKv: (id: string, persist: boolean) => MemoryKVService;
} = {
  createSimpleLogger,
  simplelLogger,
  createMemoryKv,
};

function bootstrap() {
  MetricService.load();
}

bootstrap();
