export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export type LogPayload = {
  level: LogLevel;
  msg: string;
  time?: number;
  meta?: Record<string, unknown>;
};

export type LevelLogger = (message: string, meta?: Record<string, unknown>) => void;
export type LogLogger = (payload: LogPayload & Record<string, unknown>) => void;

export interface Logger {
  child(meta: Record<string, unknown>): Logger;
  addListener(callback: LogLogger): void;
  info: LevelLogger;
  error: LevelLogger;
  debug: LevelLogger;
  warn: LevelLogger;
  log: LogLogger;
}
