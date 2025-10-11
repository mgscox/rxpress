export interface RunContext {
  id: string;
  get<T = unknown>(path: string): Promise<T | undefined>;
  set(path: string, value: unknown): Promise<void>;
  has(path: string): Promise<boolean>;
  delete(path?: string): Promise<void>;
  clear(): Promise<void>;
}
