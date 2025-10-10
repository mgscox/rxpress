import type express from 'express';
import type { NextFunction, Request, Response } from 'express';

import type { Logger } from '../types/logger.types.js';
import type { NextAdapterConfig } from '../types/next.types.js';

type NextRequestHandler = (req: Request, res: Response, parsedUrl?: unknown) => Promise<void> | void;

type NextAppInstance = {
  prepare: () => Promise<void>;
  close: () => Promise<void>;
  getRequestHandler: () => NextRequestHandler;
};

let readyPromise: Promise<void> | undefined;
let nextAppInstance: NextAppInstance | undefined;

export namespace NextService {
  export function configure(app: express.Express, config: NextAdapterConfig, logger: Logger): Promise<void> {
    if (readyPromise) {
      return readyPromise;
    }

    readyPromise = (async () => {
      if (config.factory) {
        nextAppInstance = await Promise.resolve(config.factory());
      }
      else {
        let nextModule: any;

        try {
          nextModule = await import('next');
        }
        catch (error) {
          throw new Error(
            `Next.js integration requested, but the "next" package is not installed.`
            + `Add it to your application workspace (e.g. 'npm install next'): ${error}`,
          );
        }

        const nextFactory: any = typeof nextModule === 'function' ? nextModule : nextModule?.default;

        if (typeof nextFactory !== 'function') {
          throw new Error('Unable to load Next.js default export. Ensure you are using a compatible Next.js version.');
        }

        const dev = config.dev ?? process.env.NODE_ENV !== 'production';
        nextAppInstance = nextFactory({
          dev,
          dir: config.dir,
          hostname: config.hostname,
          port: config.port,
        }) as NextAppInstance;
      }

      await nextAppInstance.prepare();
      const handler = nextAppInstance.getRequestHandler();

      if (config.onReady) {
        await config.onReady({ app, handler, nextApp: nextAppInstance, logger });
        return;
      }

      const mountPath = config.basePath ?? '*';
      const pathPattern = mountPath === '*' ? '*' : mountPath;

      app.all(pathPattern, async (req: Request, res: Response, nextFn: NextFunction) => {
        try {
          await handler(req, res);
        }
        catch (error) {
          logger.error?.('Next.js request handler failed', { error: `${error}` });
          nextFn(error);
        }
      });

      logger.info?.('Next.js integration ready');
    })();

    return readyPromise;
  }

  export async function ready(): Promise<void> {
    if (readyPromise) {
      await readyPromise;
    }
  }

  export async function stop(): Promise<void> {
    if (nextAppInstance?.close) {
      await nextAppInstance.close();
    }

    nextAppInstance = undefined;
    readyPromise = undefined;
  }
}
