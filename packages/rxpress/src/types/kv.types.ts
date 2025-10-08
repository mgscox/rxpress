export interface KVBase {
  get<T = unknown>(key: string): T | undefined | Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): void | Promise<void>;
  has(key: string): boolean | Promise<boolean>;
  del(key: string): void | Promise<void>;
}
