import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { ConfigService } from 'rxpress';

export class MemoryKVService {
  private store: Record<string, unknown> = {};
  private storeFile: string | null = null;

  persist(file: string): void {
    this.storeFile = file;

    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
      Object.assign(this.store, data);
    }
    else {
      mkdirSync(dirname(file), { recursive: true });
      this.save();
    }
  }

  get<T = unknown>(key: string): T | undefined {
    return this.store[key] as T | undefined;
  }

  set<T = unknown>(key: string, value: T): void {
    this.store[key] = value;
    this.save();
  }

  has(key: string): boolean {
    return key in this.store;
  }

  del(key: string): void {
    delete this.store[key];
    this.save();
  }

  private save(): void {
    if (this.storeFile) {
      const data = JSON.stringify(this.store, null, 2);
      writeFileSync(this.storeFile, data, 'utf-8');
    }
  }
}

export const createMemoryKv = (id: string, persist = false) => {
  const kv = new MemoryKVService();

  if (persist) {
    const file = join(ConfigService.getRootDir(), `data/kv-${id}.json`);
    kv.persist(file);
  }

  kv.set('kv-id', id);
  return kv;
};
