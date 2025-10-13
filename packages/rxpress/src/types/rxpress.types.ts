import type { json } from 'express';
import type { HelmetOptions as HelmetLibraryOptions } from 'helmet';
import cookieSession from 'cookie-session';

import type { MetricsConfig } from './metrics.types.js';
import type { NextAdapterConfig } from './next.types.js';
import type { DocumentationConfig } from './documentation.types.js';
import type { GrpcConfig } from './grpc.types.js';

type JsonOptions = Parameters<typeof json>[0];

export type HelmetOptions = HelmetLibraryOptions;
export type CookieSessionOptions = Parameters<typeof cookieSession>[0];
export type RxpressConfig = {
  port?: number;
  hostname?: string;
  servername?: string;
  loadEnv?: boolean;
  envFiles?: string[];
  rootDir?: string;
  metrics?: MetricsConfig;
  processHandlers?: boolean;
  json?: JsonOptions;
  wsPath?: string;
  next?: NextAdapterConfig;
  staticRoutDir?: string;
  documentation?: DocumentationConfig;
  helmet?: HelmetOptions;
  session?: CookieSessionOptions;
  workbench?: {
    path: string;
  };
  grpc?: GrpcConfig;
};
export type RxpressStartConfig = {
  eventDir?: string;
  handlerDir?: string;
  cronDir?: string;
  port?: number;
  validateEvents?: boolean;
}
