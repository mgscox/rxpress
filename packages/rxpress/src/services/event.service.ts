import { Subject } from 'rxjs';

import { EventConfig, Events } from '../types/rpc.types.js';
import { KVBase } from '../types/kv.types.js';
import { Logger } from '../types/logger.types.js';
import { Emit } from '../types/emit.types.js';

const events$: Record<string, Subject<unknown>> = {};

export namespace EventService {
  export const emit: Emit = (param: { topic: string; data?: unknown }) => {
    events$[param.topic]?.next(param.data || null);
  };

  export const add = (
    events: Events | EventConfig,
    { logger, kv }: { logger: Logger; kv: KVBase },
  ) => {
    const entries = Array.isArray(events) ? events : [events];

    for (const event of entries) {
      event.subscribe.forEach((topic: string) => {
        events$[topic] ?? (events$[topic] = new Subject());
        events$[topic].subscribe({
          next: (input) => event.handler(input, { trigger: topic, logger, kv }),
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
