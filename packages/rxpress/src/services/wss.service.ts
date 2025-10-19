import http from 'node:http';
import { Server as SocketIOServer, type ServerOptions, type Socket } from 'socket.io';
import type { SpanContext } from '@opentelemetry/api';

import { EventService } from './event.service.js';
import { TopologyService } from './topology.service.js';
import type { Logger } from '../types/index.js';

type BroadcastEnvelope = {
  payload: unknown;
  exclude?: Socket[];
  excludeIds?: string[];
  traceContext?: SpanContext;
};

type WSSOptions = {
  server: http.Server;
  path?: string;
  logger: Logger;
};

export class WSSService {
  private readonly socketServer: SocketIOServer;
  private readonly logger: Logger;

  constructor(options: WSSOptions) {
    const { server, path, logger } = options;
    this.logger = logger;

    const ioOptions: Partial<ServerOptions> = {
      transports: ['websocket'],
      serveClient: false,
    };

    if (path && path !== '/') {
      ioOptions.path = path;
    }

    this.socketServer = new SocketIOServer(server, ioOptions);

    this.socketServer.engine.on('headers', (headers, req) => {
      const hasStickyCookie = typeof req.headers.cookie === 'string' && /rxpress_sid=/.test(req.headers.cookie);

      if (!hasStickyCookie) {
        const value = generateStickyId();
        headers['Set-Cookie'] = `rxpress_sid=${value}; Path=/; HttpOnly; SameSite=Lax`;
      }
    });

    this.socketServer.on('connection', (socket) => {
      EventService.emit({ topic: 'SYS::WSS::CONNECTION', data: { socket } });
      TopologyService.registerEmit('SYS::WSS::CONNECTION', 'internal:wss');

      socket.on('message', (data) => {
        EventService.emit({ topic: 'SYS::WSS::MESSAGE', data: { socket, data } });
        TopologyService.registerEmit('SYS::WSS::MESSAGE', 'internal:wss');

        if (data && typeof data === 'object' && 'path' in data) {
          const topic = `SYS::WSS::ROUTE::${(data as { path: string }).path}`;
          EventService.emit({ topic, data: { socket, data } });
          TopologyService.registerEmit(topic, 'internal:wss');
        }
      });

      socket.on('disconnect', (reason) => {
        EventService.emit({ topic: 'SYS::WSS::CLOSE', data: { socket, reason } });
        TopologyService.registerEmit('SYS::WSS::CLOSE', 'internal:wss');
      });
    });

    this.socketServer.on('error', (error) => {
      logger.error?.('[rxpress] socket.io error', { error });
      EventService.emit({ topic: 'SYS::WSS::ERROR', data: { error } });
    });
  }

  get instance() {
    return this.socketServer;
  }

  broadcast(envelope: BroadcastEnvelope) {
    const excludeIds = new Set<string>(envelope.excludeIds ?? []);

    envelope.exclude?.forEach((socket) => {
      if (socket?.id) {
        excludeIds.add(socket.id);
      }
    });

    const emitter = excludeIds.size
      ? this.socketServer.except(Array.from(excludeIds))
      : this.socketServer;

    emitter.emit('message', envelope.payload, envelope.traceContext ?? null);
  }

  close() {
    this.socketServer.disconnectSockets(true);
    this.socketServer.removeAllListeners();
  }
}

function generateStickyId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}
