import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { helpers } from 'rxpress';
import type { KVBase } from 'rxpress';

interface PersistedKvOptions {
  namespace: string;
  filePath: string;
}

const encoding = 'utf-8';

class PersistedKv implements KVBase {
  private readonly kv: KVBase;
  private readonly cache = new Map<string, unknown>();
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;
  private savingPromise: Promise<void> | null = null;

  constructor(private readonly options: PersistedKvOptions) {
    this.kv = helpers.createMemoryKv(options.namespace, false);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    if (!this.loadingPromise) {
      this.loadingPromise = (async () => {
        const file = resolve(this.options.filePath);
        const folder = dirname(file);

        if (!existsSync(folder)) {
          await mkdir(folder, { recursive: true });
        }

        if (existsSync(file)) {
          const raw = await readFile(file, { encoding });

          if (raw.trim().length > 0) {
            const parsed = JSON.parse(raw) as Record<string, unknown>;

            for (const [key, value] of Object.entries(parsed)) {
              this.cache.set(key, value);
              await this.kv.set(key, value);
            }
          }
        }
        else {
          await this.save();
        }

        this.loaded = true;
      })();
    }

    await this.loadingPromise;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    await this.ensureLoaded();
    return (await this.kv.get<T>(key)) ?? undefined;
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    await this.ensureLoaded();
    await this.kv.set(key, value);
    this.cache.set(key, value);
    await this.save();
  }

  async has(key: string): Promise<boolean> {
    await this.ensureLoaded();
    return (await this.kv.has(key)) ?? false;
  }

  async del(key: string): Promise<void> {
    await this.ensureLoaded();
    await this.kv.del(key);
    this.cache.delete(key);
    await this.save();
  }

  private async save(): Promise<void> {
    if (this.savingPromise) {
      await this.savingPromise;
      return;
    }

    this.savingPromise = (async () => {
      const file = resolve(this.options.filePath);
      const folder = dirname(file);

      if (!existsSync(folder)) {
        await mkdir(folder, { recursive: true });
      }

      const payload = JSON.stringify(Object.fromEntries(this.cache), null, 2);
      await writeFile(file, payload, { encoding });
    })();

    try {
      await this.savingPromise;
    }
    finally {
      this.savingPromise = null;
    }
  }
}

export function createPersistedKv(namespace: string, baseDir: string, fileName = 'state.json'): KVBase {
  const filePath = resolve(baseDir, '..', 'data', `${namespace}-${fileName}`);
  return new PersistedKv({ namespace, filePath });
}
