import { ConfigService } from "./config.service"
import { EventService } from "./event.service";

const logLevel = ConfigService.env<string>('LOG_LEVEL', 'info');

const isDebugEnabled = logLevel === 'debug'
const isInfoEnabled = ['info', 'debug'].includes(logLevel)
const isWarnEnabled = ['warn', 'info', 'debug', 'trace'].includes(logLevel)

export type LogListener = (level: string, msg: string, args?: unknown) => void
export type LogData = {level: string, time: number, msg: string, meta: Record<string, unknown>};

export class Logger {
  constructor(
    readonly isVerbose: boolean = false,
    private readonly meta: Record<string, unknown> = {},
    private readonly coreListeners: LogListener[] = [],
  ) {}

  child(meta: Record<string, unknown>): Logger {
    return new Logger(this.isVerbose, { ...this.meta, ...meta }, this.coreListeners)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _log(level: string, msg: string, args?: any) {
    const time = Date.now()
    const meta = { ...this.meta, ...(args ?? {}) }
    EventService.emit({topic: 'app::log', data: {level, time, msg, meta}});
  }

  info(message: string, args?: unknown) {
    if (isInfoEnabled) {
      this._log('info', message, args)
    }
  }

  error(message: string, args?: unknown) {
    this._log('error', message, args)
  }

  debug(message: string, args?: unknown) {
    if (isDebugEnabled) {
      this._log('debug', message, args)
    }
  }

  warn(message: string, args?: unknown) {
    if (isWarnEnabled) {
      this._log('warn', message, args)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  log(args: any) {
    this._log(args.level ?? 'info', args.msg, args)
  }

}

export const globalLogger = new Logger()
