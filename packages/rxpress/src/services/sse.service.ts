import { Request, Response } from 'express';
import { Logger, SSESendOptions } from '../index.js';
import * as z from 'zod';
import type { RPCStreamFormat } from '../types/rpc.types.js';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events'; 

export class SSEService {
  private streamClosed = false;
  private req: Request;
  private res: Response;
  private sseRoute = false;
  private readonly format: RPCStreamFormat;
  private readonly schema?: z.ZodTypeAny;

  constructor(req: Request, res: Response, format: RPCStreamFormat, schema?: z.ZodTypeAny) {
    this.req = req;
    this.res = res;
    this.format = format;
    this.schema = schema;
  }

  get isSseRoute(): boolean {
    return this.sseRoute;
  }

  sendSSEHeaders() {
    this.res.statusCode = 200;

    if (this.format === 'event') {
      this.res.setHeader('Content-Type', 'text/event-stream');
      this.res.setHeader('Cache-Control', 'no-cache, no-transform');
      this.res.setHeader('Connection', 'keep-alive');
      this.res.setHeader('X-Accel-Buffering', 'no');
    }
    else {
      const expectJson = this.schema instanceof z.ZodObject || this.schema instanceof z.ZodArray;
      this.res.setHeader('Content-Type', expectJson ? 'application/x-ndjson; charset=utf-8' : 'text/plain; charset=utf-8');
      this.res.setHeader('Cache-Control', 'no-store, no-transform');
      this.res.setHeader('Transfer-Encoding', 'chunked');
      this.res.setHeader('Connection', 'keep-alive');
    }

    this.res.flushHeaders();
    this.req.once('close', () => this.closeStream());
    this.sseRoute = true;
  }

  closeStream() {
    if (this.streamClosed) {
      return;
    }

    this.streamClosed = true;

    if (!this.res.writableEnded) {
      this.res.end();
    }
  }

  private writeSseFrame(lines: string[]) {
    this.res.write(`${lines.join('\n')}\n\n`);
    (this.res as Response & { flush?: () => void }).flush?.();
  }

  private buildSSELines(options?: SSESendOptions) {
    const lines: string[] = [];

    if (options?.id) {
      lines.push(`id: ${options.id}`);
    }

    lines.push(`event: ${options?.event || 'message'}`);

    if (typeof options?.retry === 'number') {
      lines.push(`retry: ${options.retry}`);
    }

    return lines;
  }

  emitSseError(reason: unknown, options?: SSESendOptions) {
    if (this.streamClosed || this.res.writableEnded) {
      return;
    }

    const payload = reason instanceof Error ? reason.message : `${reason}`;

    if (this.format === 'event') {
      const lines = this.buildSSELines(options ?? { event: 'error' });
      lines.push(`data: ${JSON.stringify({ error: payload })}`);
      this.writeSseFrame(lines);
    }
    else {
      const chunk = `${JSON.stringify({ error: payload })}\n`;
      this.res.write(chunk);
      (this.res as Response & { flush?: () => void }).flush?.();
    }

    this.closeStream();
  }

  emitSsePayload(payload: unknown, options?: SSESendOptions) {
    if (this.streamClosed || this.res.writableEnded) {
      return;
    }

    let serialised: string | Buffer;
    let appendNewline = false;

    try {
      const parsed = this.schema ? this.schema.parse(payload) : payload;
      const parsedIsJson = typeof parsed === 'object' && parsed !== null && !Buffer.isBuffer(parsed) && !(parsed instanceof Uint8Array);

      if (Buffer.isBuffer(parsed)) {
        serialised = parsed;
      }
      else if (typeof parsed === 'string') {
        serialised = parsed;
      }
      else if (parsed instanceof Uint8Array) {
        serialised = Buffer.from(parsed);
      }
      else {
        serialised = JSON.stringify(parsed);
      }

      appendNewline = appendNewline || parsedIsJson;

      if (!appendNewline && this.schema) {
        appendNewline = this.schema instanceof z.ZodObject || this.schema instanceof z.ZodArray;
      }
    }
    catch (reason) {
      this.emitSseError(reason, options);
      throw new Error(`SSE payload validation failed: ${reason}`);
    }

    if (this.format === 'event') {
      const lines = this.buildSSELines(options);
      const value = typeof serialised === 'string' ? serialised : serialised.toString('utf8');
      value
        .split(/\r?\n/)
        .forEach((line) => lines.push(`data: ${line}`));
      this.writeSseFrame(lines);
      return;
    }

    if (typeof serialised === 'string') {
      this.res.write(serialised);

      if (appendNewline && !serialised.endsWith('\n')) {
        this.res.write('\n');
      }
    }
    else {
      this.res.write(serialised);

      if (appendNewline) {
        this.res.write('\n');
      }
    }

    (this.res as Response & { flush?: () => void }).flush?.();
  }
}

type Options<T> = {
  logger?: Logger;
  // Parse the joined `data:` payload into T
  parse?: (data: string, logger?: Logger) => T;
  // Optional cancellation
  signal?: AbortSignal;
};

// Default JSON parser
function defaultParse<T = string>(data: string): T | string {
  try {
    return JSON.parse(data);
  } 
  catch {
    return data;
  }
}

class SSEChunker<T> extends EventEmitter {
  logger: Logger | undefined;
  parse;
  signal: AbortSignal | undefined;
  constructor(param?: Options<T>) {
    super();
    const {logger, parse = defaultParse, signal} = param || {};
    this.logger = logger;
    this.parse = parse || defaultParse<T>;
    this.signal = signal;
  }
  async run(body: NodeReadableStream<Uint8Array>) {
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let message = '';

    for await (const raw of Readable.fromWeb(body)) {
      buffer += typeof raw === 'string'
        ? raw
        : decoder.decode(raw, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed || trimmed === '[DONE]') {
          continue;
        }

        const delta = this.parse(trimmed, this.logger);
        message += delta;

        if (delta) {
          this.emit('delta', delta as T);
        }
      }
    }

    // handle any trailing bytes
    buffer += decoder.decode();;
    const final = buffer.trim();

    if (final !== '[DONE]') {
      const delta = this.parse(final, this.logger);
      message += delta;

      if (delta) {
        this.emit('delta', delta as T);
      }
    }

    this.emit('complete', message as T);
  }
}

export async function SSEChunkHandler<T>(param?: Options<T>): Promise<SSEChunker<T>> {
  return new SSEChunker<T>(param);
}