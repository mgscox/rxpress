import { config } from "dotenv";
import { join } from 'node:path';

config({
    path: join('..', '..', '.env'),
    encoding: 'utf8',
})

export namespace ConfigService {
    export const env = <T>(field: string, defaultValue?: T): T => {
        return (process.env[field] || defaultValue) as T;
    }
}