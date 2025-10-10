import type { json } from 'express';

import { MetricsConfig } from './metrics.types.js';
import type { NextAdapterConfig } from './next.types.js';

type JsonOptions = Parameters<typeof json>[0];

export type RxpressConfig = {
  port?: number;
  hostname?: string;
  loadEnv?: boolean;
  envFiles?: string[];
  rootDir?: string;
  metrics?: MetricsConfig;
  processHandlers?: boolean;
  json?: JsonOptions;
  wsPath?: string;
  next?: NextAdapterConfig;
};
