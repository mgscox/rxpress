import { KVBase, KVPath } from '../types/kv.types.js';
import { splitPath, setInObject, getFromObject, hasInObject, deleteInObject } from '../utils/path.utils.js';

async function resolve<T>(value: T | Promise<T>): Promise<T> {
  return Promise.resolve(value);
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

export function createKVPath(kv: KVBase): KVPath {
  const getRoot = async (key: string): Promise<Record<string, unknown>> => {
    const existing = await resolve(kv.get<Record<string, unknown>>(key));

    if (existing && typeof existing === 'object') {
      return cloneValue(existing);
    }

    return {};
  };

  return {
    async get<T = unknown>(path: string): Promise<T | undefined> {
      const [rootKey, ...segments] = splitPath(path);

      if (!rootKey) {
        return undefined;
      }

      if (segments.length === 0) {
        return resolve(kv.get<T>(rootKey));
      }

      const root = await resolve(kv.get<Record<string, unknown>>(rootKey));

      if (!root) {
        return undefined;
      }

      return getFromObject<T>(root, segments);
    },
    async has(path: string): Promise<boolean> {
      const [rootKey, ...segments] = splitPath(path);

      if (!rootKey) {
        return false;
      }

      if (segments.length === 0) {
        return resolve(kv.has(rootKey)).then(Boolean);
      }

      const root = await resolve(kv.get<Record<string, unknown>>(rootKey));

      if (!root) {
        return false;
      }

      return hasInObject(root, segments);
    },
    async set(path: string, value: unknown): Promise<void> {
      const [rootKey, ...segments] = splitPath(path);

      if (!rootKey) {
        return;
      }

      if (segments.length === 0) {
        await resolve(kv.set(rootKey, value));
        return;
      }

      const root = await getRoot(rootKey);
      setInObject(root, segments, value);
      await resolve(kv.set(rootKey, root));
    },
    async delete(path: string): Promise<void> {
      const [rootKey, ...segments] = splitPath(path);

      if (!rootKey) {
        return;
      }

      if (segments.length === 0) {
        await resolve(kv.del(rootKey));
        return;
      }

      const root = await getRoot(rootKey);
      deleteInObject(root, segments);

      if (Object.keys(root).length === 0) {
        await resolve(kv.del(rootKey));
      }
      else {
        await resolve(kv.set(rootKey, root));
      }
    },
  };
}
