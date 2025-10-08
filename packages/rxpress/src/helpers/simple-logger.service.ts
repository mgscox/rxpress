import type { Logger as RxpressLogger, LogPayload, LogLogger } from 'rxpress';

class SimpleLogger implements RxpressLogger {
  child(_meta: Record<string, unknown>): RxpressLogger {
    this.error(`child logger not implemented for demo`);
    return new SimpleLogger();
  }

  addListener(_callback: LogLogger) {
    this.error(`addListener not implemented for demo`);
  }

  info(message: string, meta?: Record<string, unknown>) {
    this.write('info', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>) {
    this.write('error', message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>) {
    this.write('debug', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    this.write('warn', message, meta);
  }

  log(payload: LogPayload & Record<string, unknown>): void {
    const { level = 'info', msg, meta, ...rest } = payload;
    this.write(level, msg, { ...meta, ...rest });
  }

  private write(level: LogPayload['level'], message: string, meta?: Record<string, unknown>) {
    const consoleTarget =
      level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    consoleTarget(
      `[${level.toUpperCase()}] ${message}`,
      meta && Object.keys(meta).length ? meta : '',
    );
  }
}

export function createSimpleLogger(): RxpressLogger {
  return new SimpleLogger();
}

export const simplelLogger = createSimpleLogger();
