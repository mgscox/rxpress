import { randomBytes, randomUUID } from 'node:crypto';

import { KVBase } from '../types/kv.types.js';
import { RunContext } from '../types/run.types.js';
import { splitPath, setInObject, getFromObject, deleteInObject, hasInObject } from '../utils/path.utils.js';

const RUN_KEY_PREFIX = '__run__:';

interface RunRecord {
  key: string;
  data: Record<string, unknown>;
  pending: number;
  kv: KVBase;
}

const runs = new Map<string, RunRecord>();

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

async function resolve<T>(value: T | Promise<T>): Promise<T> {
  return Promise.resolve(value);
}

function generateId(): string {
  if (typeof randomUUID === 'function') {
    return randomUUID();
  }

  return randomBytes(16).toString('hex');
}

function getRecord(id: string): RunRecord | undefined {
  return runs.get(id);
}

async function persist(record: RunRecord): Promise<void> {
  await resolve(record.kv.set(record.key, cloneValue(record.data)));
}

export async function createRun(kv: KVBase): Promise<RunContext> {
  const id = generateId();
  const record: RunRecord = {
    key: `${RUN_KEY_PREFIX}${id}`,
    data: {},
    pending: 1,
    kv,
  };

  runs.set(id, record);
  await resolve(kv.set(record.key, {}));

  return buildContext(id);
}

function buildContext(id: string): RunContext {
  return {
    id,
    async get<T = unknown>(path: string): Promise<T | undefined> {
      const record = getRecord(id);

      if (!record) {
        return undefined;
      }

      const segments = splitPath(path);

      if (segments.length === 0) {
        return cloneValue(record.data) as T;
      }

      return getFromObject<T>(record.data, segments);
    },
    async has(path: string): Promise<boolean> {
      const record = getRecord(id);

      if (!record) {
        return false;
      }

      const segments = splitPath(path);

      if (segments.length === 0) {
        return Object.keys(record.data).length > 0;
      }

      return hasInObject(record.data, segments);
    },
    async set(path: string, value: unknown): Promise<void> {
      const record = getRecord(id);

      if (!record) {
        return;
      }

      const segments = splitPath(path);

      if (segments.length === 0) {
        record.data = value && typeof value === 'object' ? cloneValue(value as Record<string, unknown>) : { value };
      }
      else {
        setInObject(record.data, segments, value);
      }

      await persist(record);
    },
    async delete(path?: string): Promise<void> {
      const record = getRecord(id);

      if (!record) {
        return;
      }

      const segments = path ? splitPath(path) : [];

      if (segments.length === 0) {
        record.data = {};
        await persist(record);
        return;
      }

      deleteInObject(record.data, segments);
      await persist(record);
    },
    async clear(): Promise<void> {
      const record = getRecord(id);

      if (!record) {
        return;
      }

      record.data = {};
      await persist(record);
    },
  };
}

export function retainRun(id: string): void {
  const record = getRecord(id);

  if (record) {
    record.pending += 1;
  }
}

export async function releaseRun(id: string): Promise<void> {
  const record = getRecord(id);

  if (!record) {
    return;
  }

  record.pending -= 1;

  if (record.pending > 0) {
    return;
  }

  await resolve(record.kv.del(record.key));
  runs.delete(id);
}

export { RUN_KEY_PREFIX };
