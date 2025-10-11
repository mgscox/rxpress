export interface KVBase {
  get<T = unknown>(key: string): T | undefined | Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): void | Promise<void>;
  has(key: string): boolean | Promise<boolean>;
  del(key: string): void | Promise<void>;
}

export interface KVPath {
  get<T = unknown>(path: string): Promise<T | undefined>;
  set(path: string, value: unknown): Promise<void>;
  has(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
}
