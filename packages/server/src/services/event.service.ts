import { Subject } from "rxjs";

import type { EventConfig, Events } from "../types/index.js";

const events$: Record<string, Subject<unknown>> = {};

export namespace EventService {

    export const emit = (param: {topic: string, data?: unknown}) => {
        events$[param.topic]?.next(param.data || null);
    }

    export const add = (events: Events | EventConfig) => {
        if (!Array.isArray(events)) {
            events = [events];
        }
        for (const event of events) {
            event.subscribe.forEach(topic => {
                events$[topic] ?? (events$[topic] = new Subject())
                events$[topic].subscribe({
                    next: (input) => event.handler(input, {trigger: topic})
                })
            })
        }
    }

    export const has = (event: string) => {
        return !!events$[event];
    }

    export const close = () => {
        Object.values(events$).forEach(pub => pub.complete());
    }
}