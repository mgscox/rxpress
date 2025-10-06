export abstract class KVBase {
    abstract set(value: unknown): void;
    abstract get(key: string): unknown;
    abstract has(key: string): boolean;
}