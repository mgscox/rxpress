import type express from 'express';

import type { Logger } from './logger.types.js';

type NextRequestHandler = (req: express.Request, res: express.Response, parsedUrl?: unknown) => Promise<void> | void;

type NextAppInstance = {
  prepare: () => Promise<void>;
  close: () => Promise<void>;
  getRequestHandler: () => NextRequestHandler;
};

export type NextAdapterConfig = {
  /** Path to your Next.js project root. Defaults to process.cwd(). */
  dir?: string;
  /** Whether to run Next.js in dev mode. Defaults to NODE_ENV !== 'production'. */
  dev?: boolean;
  /** Optional hostname passed to Next.js. */
  hostname?: string;
  /** Optional port passed to Next.js (used by some Next internals). */
  port?: number;
  /** Express mount path for Next routes. Defaults to handling all unmatched routes. */
  basePath?: string;
  /** Custom factory used mainly for testing to provide a Next-like app implementation. */
  factory?: () => NextAppInstance | Promise<NextAppInstance>;
  /**
   * Hook that allows advanced configuration once Next is prepared.
   * If provided, rxpress will not register the default catch-all handler.
   */
  onReady?: (param: { app: express.Express; handler: NextRequestHandler; nextApp: NextAppInstance; logger: Logger }) => Promise<void> | void;
};
