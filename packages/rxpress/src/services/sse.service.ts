import { Request, Response } from 'express';
import { SSESendOptions } from '../index.js';
import * as z from 'zod';

export class SSEService {
  private streamClosed = false;
  private req: Request;
  private res: Response;
  private sseRoute = false;

  constructor(req: Request, res: Response) {
    this.req = req;
    this.res = res;
  }

  get isSseRoute(): boolean { 
    return this.sseRoute;
  }
    
  sendSSEHeaders() {
    this.res.statusCode = 200;
    this.res.setHeader('Content-Type', 'text/event-stream');
    this.res.setHeader('Cache-Control', 'no-cache, no-transform');
    this.res.setHeader('Connection', 'keep-alive');
    this.res.setHeader('X-Accel-Buffering', 'no');
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
  };

  writeSseFrame(lines: string[]) {
    this.res.write(`${lines.join('\n')}\n\n`);
    (this.res as Response & { flush?: () => void }).flush?.();
  };

  buildSSELines(options?: SSESendOptions) {
    const lines: string[] = [];

    if (options?.id) {
      lines.push(`id: ${options.id}`);
    }

    lines.push(`event: ${options?.event || 'error'}`);

    if (typeof options?.retry === 'number') {
      lines.push(`retry: ${options.retry}`);
    }

    return lines;
  }

  emitSseError(reason: unknown, options?: SSESendOptions) {

    if (this.streamClosed || this.res.writableEnded) {
      return;
    }

    const payload = (reason instanceof Error)
      ? reason.message 
      : `${reason}`;
    const lines = this.buildSSELines(options);
    lines.push(`data: ${JSON.stringify({ error: payload })}`);
    this.writeSseFrame(lines);
    this.closeStream();
  };

  emitSsePayload(schema: z.ZodTypeAny | undefined, payload: unknown, options?: SSESendOptions) {
    let serialised: string;
    const lines = this.buildSSELines(options);

    if (this.streamClosed || this.res.writableEnded) {
      return;
    }

    try {
      const parsed = (schema)
        ? schema.parse(payload) 
        : payload;
      serialised = (typeof parsed === 'string')
        ? parsed 
        : JSON.stringify(parsed);
    }
    catch (reason) {
      this.emitSseError(reason, options);
      throw new Error(`SSE payload validation failed: ${reason}`);
    }

    serialised
      .split(/\r?\n/)
      .forEach((line) => lines.push(`data: ${line}`));
    this.writeSseFrame(lines);
  };
}
