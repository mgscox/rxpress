import { config } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from 'node:path';
import { fileURLToPath } from "node:url";

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
    const pkgFilename = join(__rootDir, '../package.json');
    export const pkg = (existsSync(pkgFilename)) 
        ? JSON.parse( readFileSync(pkgFilename, {encoding: 'utf-8'}) )
        : {};
    export function loadEnv() {
        config({
            // import order defines precidence
            path: [
                join(__rootDir, '..', 'env.'),
                join(__rootDir, '.env'),
            ],
            encoding: 'utf8',
        })
    }
}