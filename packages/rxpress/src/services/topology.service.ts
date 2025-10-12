import { basename } from 'node:path';

import type { CronConfig } from '../types/cron.types.js';
import type { EventConfig } from '../types/rpc.types.js';
import type { RPCConfig } from '../types/rpc.types.js';

const routes = new Map<string, RouteMeta>();
const events = new Map<string, EventMeta>();
const crons = new Map<string, CronMeta>();
const topics = new Map<string, TopicMeta>();

interface RouteMeta {
  id: string;
  name?: string;
  description?: string;
  method: string;
  path: string;
  origin: string;
  emits: string[];
}

interface EventMeta {
  id: string;
  name?: string;
  description?: string;
  origin: string;
  subscribes: string[];
  emits: string[];
}

interface CronMeta {
  id: string;
  name?: string;
  description?: string;
  origin: string;
  schedule: string;
  emits: string[];
}

interface TopicMeta {
  name: string;
  emitters: Set<string>;
  subscribers: Set<string>;
}

type Meta = TopicMeta | RouteMeta | EventMeta | CronMeta;

interface ValidationResult {
  missingHandlers: Array<{ topic: string; sources: string[] }>;
  unusedHandlers: Array<{ topic: string; sources: string[] }>;
}

const sanitize = (input: string): string => input.replace(/[^A-Za-z0-9_]+/g, '_');
const routeNodeId = (origin: string) => `route_${sanitize(origin)}`;
const eventNodeId = (origin: string) => `event_${sanitize(origin)}`;
const cronNodeId = (origin: string) => `cron_${sanitize(origin)}`;
const topicNodeId = (topic: string) => `topic_${sanitize(topic)}`;

const buildComment = (meta: Meta & {description?: string}) => {
  return `${meta.name ? meta.name + '\n' : ''}${meta?.description}`
}

const ensureTopic = (name: string): TopicMeta => {
  let topic = topics.get(name);

  if (!topic) {
    topic = {
      name,
      emitters: new Set<string>(),
      subscribers: new Set<string>(),
    };
    topics.set(name, topic);
  }

  return topic;
};

const recordEmit = (topic: string, sourceId: string) => {
  ensureTopic(topic).emitters.add(sourceId);
};

const recordSubscription = (topic: string, sourceId: string) => {
  ensureTopic(topic).subscribers.add(sourceId);
};

const registerRouteInternal = (route: RPCConfig, origin: string) => {
  const id = routeNodeId(origin);
  const emits = route.emits ?? [];

  routes.set(origin, {
    id,
    name: route.name,
    description: route.description,
    method: route.method,
    path: route.path,
    origin,
    emits,
  });

  for (const topic of emits) {
    recordEmit(topic, id);
  }
};

const registerEventInternal = <T>(event: EventConfig<T>, origin: string) => {
  const id = eventNodeId(origin);
  const subscribes = event.subscribe ?? [];
  const emits = event.emits ?? [];

  events.set(origin, {
    id,
    name: event.name,
    description: event.description,
    origin,
    subscribes,
    emits,
  });

  for (const topic of subscribes) {
    recordSubscription(topic, id);
  }

  for (const topic of emits) {
    recordEmit(topic, id);
  }
};

const registerCronInternal = (cron: CronConfig, origin: string) => {
  const id = cronNodeId(origin);
  const emits = cron.emits ?? [];

  crons.set(origin, {
    id,
    name: cron.name,
    description: cron.description,
    origin,
    schedule: cron.cronTime,
    emits,
  });

  for (const topic of emits) {
    recordEmit(topic, id);
  }
};

const toLabel = (type: 'route' | 'event' | 'cron', meta: RouteMeta | EventMeta | CronMeta): string => {
  switch (type) {
    case 'route': {
      const m = meta as RouteMeta;
      return `${m.method} ${m.path}`;
    }

    case 'event': {
      const e = meta as EventMeta;
      const originLabel = formatOrigin(e.origin);
      const subscriptions = e.subscribes.length ? e.subscribes.join(', ') : '(no subscriptions)';
      return `event ${subscriptions}\n${originLabel}`;
    }

    case 'cron': {
      const c = meta as CronMeta;
      return `cron ${c.schedule}`;
    }

    default:
      return 'node';
  }
};

const toDotNode = (id: string, label: string, attrs: Record<string, string>): string => {
  const attrPairs = Object.entries(attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ');
  return `  "${id}" [label="${label}" ${attrPairs}];`;
};

const toDotEdge = (from: string, to: string, label?: string): string => {
  if (label) {
    return `  "${from}" -> "${to}" [label="${label}"];`;
  }

  return `  "${from}" -> "${to}";`;
};

const toDot = (): string => {
  const lines: string[] = ['digraph rxpress_topology {', '  rankdir=LR;'];
  const defined = new Set<string>();

  for (const meta of routes.values()) {
    lines.push(toDotNode(meta.id, toLabel('route', meta), { shape: 'box', style: 'filled', fillcolor: '#e3f2fd', comment: buildComment(meta) }));
    defined.add(meta.id);
  }

  for (const meta of events.values()) {
    lines.push(toDotNode(meta.id, toLabel('event', meta), { shape: 'ellipse', style: 'filled', fillcolor: '#ede7f6', comment: buildComment(meta) }));
    defined.add(meta.id);
  }

  for (const meta of crons.values()) {
    lines.push(toDotNode(meta.id, toLabel('cron', meta), { shape: 'hexagon', style: 'filled', fillcolor: '#fff8e1', comment: buildComment(meta) }));
    defined.add(meta.id);
  }

  for (const topicMeta of topics.values()) {
    const id = topicNodeId(topicMeta.name);
    lines.push(toDotNode(id, topicMeta.name, { shape: 'circle', style: 'filled', fillcolor: '#e8f5e9', fixedsize: 'true', width: '1.2', height: '1.2', comment: buildComment(topicMeta) }));
    defined.add(id);

    for (const emitter of topicMeta.emitters) {
      if (!defined.has(emitter)) {
        lines.push(toDotNode(emitter, emitter, { shape: 'diamond', style: 'dashed', color: '#b0bec5', comment: buildComment(topicMeta) }));
        defined.add(emitter);
      }

      lines.push(toDotEdge(emitter, id));
    }

    for (const subscriber of topicMeta.subscribers) {
      if (!defined.has(subscriber)) {
        lines.push(toDotNode(subscriber, subscriber, { shape: 'diamond', style: 'dashed', color: '#c5cae9', comment: buildComment(topicMeta) }));
        defined.add(subscriber);
      }

      lines.push(toDotEdge(id, subscriber));
    }
  }

  lines.push('}');
  return lines.join('\n');
};

const validate = (ignorePrefixes: string[] = []): ValidationResult => {
  const missingHandlers: Array<{ topic: string; sources: string[] }> = [];
  const unusedHandlers: Array<{ topic: string; sources: string[] }> = [];

  const shouldIgnore = (topic: string) => ignorePrefixes.some((prefix) => topic.startsWith(prefix));

  for (const [name, topic] of topics.entries()) {
    if (shouldIgnore(name)) {
      continue;
    }

    if (topic.emitters.size > 0 && topic.subscribers.size === 0) {
      missingHandlers.push({ topic: name, sources: [...topic.emitters] });
    }

    if (topic.subscribers.size > 0 && topic.emitters.size === 0) {
      unusedHandlers.push({ topic: name, sources: [...topic.subscribers] });
    }
  }

  return { missingHandlers, unusedHandlers };
};

const reset = (): void => {
  routes.clear();
  events.clear();
  crons.clear();
  topics.clear();
};

export namespace TopologyService {
  export const clear = reset;

  export const registerRoute = (route: RPCConfig, origin: string) => {
    registerRouteInternal(route, origin);
  };

  export const registerEvent = <T>(event: EventConfig<T>, origin: string) => {
    registerEventInternal(event, origin);
  };

  export const registerCron = (cron: CronConfig, origin: string) => {
    registerCronInternal(cron, origin);
  };

  export const registerSubscription = (topic: string, sourceId: string) => {
    recordSubscription(topic, sourceId);
  };

  export const registerEmit = (topic: string, sourceId: string) => {
    recordEmit(topic, sourceId);
  };

  export const validateTopology = (ignorePrefixes: string[] = []): ValidationResult => validate(ignorePrefixes);

  export const generateDot = (): string => toDot();
}

export default TopologyService;

function formatOrigin(origin: string): string {
  if (!origin) {
    return 'unknown';
  }

  const colonIndex = origin.indexOf(':');
  const identifier = colonIndex >= 0 ? origin.slice(colonIndex + 1) : origin;

  if (!identifier) {
    return origin;
  }

  if (identifier.startsWith('inline')) {
    return identifier.replace(/^[a-z-]+:/i, '');
  }

  if (identifier.includes('/')) {
    const file = basename(identifier);
    return file.replace(/\.event\.js$/i, '');
  }

  return identifier;
}
