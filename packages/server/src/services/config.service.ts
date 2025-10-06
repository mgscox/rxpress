import { config } from "dotenv";
import { dirname, join } from 'node:path';
import { fileURLToPath } from "node:url";

config({
    path: join('..', '..', '.env'),
    encoding: 'utf8',
})

export namespace ConfigService {
    export const getDirname = (importMetaUrl: string) => {
        const __filename = fileURLToPath(importMetaUrl);
        const __dirname = dirname(__filename);
        return __dirname;
    }
    export const __rootDir = join(getDirname(import.meta.url), '..', '..');
    export const env = <T>(field: string, defaultValue?: T): T => {
        return (process.env[field] || defaultValue) as T;
    }
}