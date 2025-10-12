import { Subject } from 'rxjs';
import type { SpanContext } from '@opentelemetry/api';
import { SpanStatusCode } from '@opentelemetry/api';
import type { ZodType } from 'zod';

import { EventConfig } from '../types/rpc.types.js';
import { KVBase } from '../types/kv.types.js';
import { Logger } from '../types/logger.types.js';
import { Emit } from '../types/emit.types.js';
import { RunContext } from '../types/run.types.js';
import { createKVPath } from './kv-path.service.js';
import { retainRun, releaseRun } from './run.service.js';
import { MetricService } from './metrics.service.js';

type EmitPayload = {
  data?: unknown;
  run?: RunContext;
  traceContext?: SpanContext;
};

const events$: Record<string, Subject<EmitPayload>> = {};

export namespace EventService {
  export const emit: Emit = ({ topic, data, run, traceContext }) => {
    events$[topic]?.next({ data, run, traceContext });
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
            const { data, run, traceContext } = payload;
            const emitBase: Emit = run
              ? (param) => emit({ ...param, run })
              : emit;

            if (run) {
              retainRun(run.id);
            }

            const tracer = MetricService.getTracer();
            const links = traceContext
              ? [{ context: traceContext, attributes: { 'rxpress.link.type': 'emit', 'rxpress.event.topic': topic } }]
              : undefined;

            tracer.startActiveSpan(`event ${topic}`, { links }, async (span) => {
              span.setAttributes({
                'messaging.system': 'rxpress',
                'messaging.destination': topic,
                'rxpress.event.subscriptions': event.subscribe.join(','),
              });

              try {
                if (event.strict && !event.schema) {
                  logger.error?.('Strict event missing schema', { topic });
                  span.setStatus({ code: SpanStatusCode.ERROR, message: 'missing schema for strict event' });
                  return;
                }

                let payloadValue = data as T;

                if (event.schema) {
                  const schema = event.schema as ZodType<T>;
                  const parsed = schema.safeParse(data);

                  if (!parsed.success) {
                    if (event.strict) {
                      logger.error?.('Event payload failed strict validation', {
                        topic,
                        issues: parsed.error.issues,
                      });
                      span.recordException(parsed.error);
                      span.setStatus({ code: SpanStatusCode.ERROR, message: 'validation failed' });
                      return;
                    }

                    logger.warn?.('Event payload failed schema validation; continuing with original shape', {
                      topic,
                      issues: parsed.error.issues,
                    });
                  }
                  else {
                    payloadValue = parsed.data as T;
                  }
                }

                const emitForHandler: Emit = (param) => emitBase({ ...param, traceContext: span.spanContext() });

                const result = event.handler(payloadValue, {
                  trigger: topic,
                  logger,
                  kv,
                  kvPath,
                  emit: emitForHandler,
                  run,
                });

                await Promise.resolve(result);
                span.setStatus({ code: SpanStatusCode.OK });
              }
              catch (error) {
                logger.error?.('Event handler failed', { error: `${error}`, topic });
                span.recordException(error as Error);
                span.setStatus({ code: SpanStatusCode.ERROR, message: `${error}` });
              }
              finally {
                if (run) {
                  releaseRun(run.id).catch((releaseError) => {
                    logger.error?.('Failed to release run scope after event', { error: `${releaseError}`, topic });
                  });
                }

                span.end();
              }
            });
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
