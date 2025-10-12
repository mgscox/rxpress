import { Subject } from 'rxjs';

import { EventConfig } from '../types/rpc.types.js';
import type { ZodType } from 'zod';
import { KVBase } from '../types/kv.types.js';
import { Logger } from '../types/logger.types.js';
import { Emit } from '../types/emit.types.js';
import { RunContext } from '../types/run.types.js';
import { createKVPath } from './kv-path.service.js';
import { retainRun, releaseRun } from './run.service.js';

type EmitPayload = {
  data?: unknown;
  run?: RunContext;
};

const events$: Record<string, Subject<EmitPayload>> = {};

export namespace EventService {
  export const emit: Emit = ({ topic, data, run }) => {
    events$[topic]?.next({ data, run });
  };

  export const add = <T = unknown>(
    events: EventConfig<T> | EventConfig<T>[],
    { logger, kv, emit }: { logger: Logger; kv: KVBase, emit: Emit },
  ) => {
    const entries = Array.isArray(events) ? events : [events];
    const kvPath = createKVPath(kv);

    for (const event of entries) {
      event.subscribe.forEach((topic: string) => {
        events$[topic] ?? (events$[topic] = new Subject());
        events$[topic].subscribe({
          next: (payload) => {
            const { data, run } = payload;
            const emitForHandler: Emit = run
              ? (param) => emit({ ...param, run })
              : emit;

            if (run) {
              retainRun(run.id);
            }

            try {
              let payload = data as T;

              if (event.strict && !event.schema) {
                logger.error?.('Strict event missing schema', { topic });
                return;
              }

              if (event.schema) {
                const schema = event.schema as ZodType<T>;
                const parsed = schema.safeParse(data);

                if (!parsed.success) {

                  if (event.strict) {
                    logger.error?.('Event payload failed strict validation', {
                      topic,
                      issues: parsed.error.issues,
                    });
                    return;
                  }
                  else {
                    logger.warn?.('Event payload failed schema validation; continuing with original shape', {
                      topic,
                      issues: parsed.error.issues,
                    });
                  }

                }

              }

              const result = event.handler(payload, {
                trigger: topic,
                logger,
                kv,
                kvPath,
                emit: emitForHandler,
                run,
              });

              Promise
                .resolve(result)
                .catch((error) => {
                  logger.error?.('Event handler failed', { error: `${error}`, topic });
                })
                .finally(() => {
                  if (run) {
                    releaseRun(run.id).catch((error) => {
                      logger.error?.('Failed to release run scope after event', { error: `${error}`, topic });
                    });
                  }
                });
            }
            catch (error) {
              logger.error?.('Event handler threw', { error: `${error}`, topic });

              if (run) {
                releaseRun(run.id).catch((releaseError) => {
                  logger.error?.('Failed to release run scope after event', { error: `${releaseError}`, topic });
                });
              }
            }
          },
        });
      });
    }
  };

  export const has = (event: string) => {
    return !!events$[event];
  };

  export const close = () => {
    Object.values(events$).forEach((pub) => pub.complete());
  };
}
