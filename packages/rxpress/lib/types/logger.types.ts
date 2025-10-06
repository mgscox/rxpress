export type Loglevel = 'debug' | 'info' | 'warn' | 'error';
export type LogData = {
    level: Loglevel,
    message?: string,
    error?: Error,
    meta: unknown,
}
export type Logger = (data: LogData) => void | Promise<void>