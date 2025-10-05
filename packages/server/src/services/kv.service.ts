import { existsSync, writeFileSync } from 'node:fs';

export class KVService {
    private store: Record<string, string> = {};
    private storeFile: string | null = null;

    persist(file: string): void {
        this.storeFile = file;
        if (existsSync(file)) {
            const data = JSON.parse( String( writeFileSync(file, 'utf-8') ) );
            Object.assign(this.store, data);
        }
    }

    get(key: string): string | undefined {
        return this.store[key];
    }
    
    set(key: string, value: string): void {
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

export const createKv = (id: string, persist = false): KVService => {
    const kv = new KVService();
    if (persist) {
        kv.persist(`./data/kv-${id}.json`);
    }
    return kv;
}