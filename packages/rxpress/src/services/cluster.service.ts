import cluster, { type Worker } from 'node:cluster';
import http from 'node:http';
import os from 'node:os';
import type { SpanContext } from '@opentelemetry/api';

import { setupMaster, setupWorker } from '@socket.io/sticky';
import { createAdapter, setupPrimary } from '@socket.io/cluster-adapter';

import type { ClusterConfig } from '../types/cluster.types.js';
import type { Logger } from '../types/logger.types.js';
import { EventService } from './event.service.js';
import { WSSService } from './wss.service.js';

type NormalizedClusterConfig = {
  enabled: boolean;
  workers: number;
  restartOnExit: boolean;
};

type WorkerReadyMessage = {
  type: 'cluster:worker:ready';
  workerId: number;
};

type WorkerShutdownAckMessage = {
  type: 'cluster:shutdown:ack';
  workerId: number;
};

type WorkerPrimaryMessage = WorkerReadyMessage | WorkerShutdownAckMessage | Record<string, unknown>;

type PrimaryShutdownMessage = {
  type: 'cluster:shutdown';
};

type PrimaryBroadcastDispatchMessage = {
  type: 'cluster:wss:broadcast';
  payload: {
    data: unknown;
    traceContext?: SpanContext;
    excludeIds?: string[];
  };
};

type StickySocketIO = {
  type: 'sticky:connection'
}

type PrimaryWorkerMessage = (PrimaryShutdownMessage | PrimaryBroadcastDispatchMessage | StickySocketIO) & {source?: string}
type GracefulSignal = 'SIGINT' | 'SIGTERM';

type PrimaryOptions = {
  port: number;
  hostname: string;
  logger: Logger;
};

type WorkerOptions = {
  port: number;
  hostname: string;
  logger: Logger;
  createHttpServer: (workerId: string) => Promise<{ server: http.Server; wss: WSSService }>;
};

let normalizedConfig: NormalizedClusterConfig = {
  enabled: false,
  workers: 1,
  restartOnExit: true,
};

let primaryServer: http.Server | null = null;
let shuttingDown = false;

const workerRegistry = new Map<number, Worker>();
const readyWorkers = new Set<number>();
const shutdownAcks = new Set<number>();

let workerWss: WSSService | null = null;

const shutdownResolvers: Array<() => void> = [];
let readyResolver: (() => void) | null = null;

export namespace ClusterService {
  export function configure(config?: ClusterConfig) {
    const cpuCount = Math.max(os.cpus()?.length ?? 1, 1);
    const hasExplicitCluster = !!config;
    const requestedWorkers = config?.workers ?? (hasExplicitCluster ? cpuCount : 1);
    const workers = requestedWorkers > 0 ? requestedWorkers : (hasExplicitCluster ? cpuCount : 1);
    const restartOnExit = config?.restartOnExit ?? true;

    normalizedConfig = {
      enabled: hasExplicitCluster && workers > 1,
      workers,
      restartOnExit,
    };
  }

  export function shouldUseCluster() {
    return normalizedConfig.enabled;
  }

  export function isPrimaryProcess() {
    return normalizedConfig.enabled && cluster.isPrimary;
  }

  export function isWorkerProcess() {
    return normalizedConfig.enabled && cluster.isWorker;
  }

  export async function startPrimary(options: PrimaryOptions): Promise<{ server: http.Server; port: number }> {
    if (!normalizedConfig.enabled || !cluster.isPrimary) {
      throw new Error('ClusterService.startPrimary called in non-primary process or without cluster enabled.');
    }

    const { port, hostname, logger } = options;

    primaryServer = http.createServer();
    setupMaster(primaryServer, { loadBalancingMethod: 'least-connection' });
    setupPrimary();
    cluster.setupPrimary({ serialization: 'advanced' });

    await new Promise<void>((resolve, reject) => {
      primaryServer!.on('error', reject);
      primaryServer!.listen(port, hostname, resolve);
    });

    await forkWorkers(logger);

    const address = primaryServer.address();
    const resolvedPort = typeof address === 'object' && address ? address.port : port;

    logger.info?.(`[rxpress] cluster primary listening on ${hostname}:${resolvedPort} with ${workerRegistry.size} workers`);
    EventService.emit({
      topic: 'SYS::CLUSTER::PRIMARY::START',
      data: {
        hostname,
        port: resolvedPort,
        workers: workerRegistry.size,
      },
    });

    setupSignalHandlers(logger);

    return { server: primaryServer!, port: resolvedPort };
  }

  export async function startWorker(options: WorkerOptions): Promise<{ server: http.Server; port: number }> {
    if (!normalizedConfig.enabled || !cluster.isWorker) {
      throw new Error('ClusterService.startWorker called in non-worker process or without cluster enabled.');
    }

    const { createHttpServer, logger, port, hostname } = options;
    const workerId = getCurrentWorkerId();
    const { server, wss } = await createHttpServer(`${workerId}`);
    workerWss = wss;

    const io = wss.instance;
    io.adapter(createAdapter());
    setupWorker(io);

    wireWorkerMessaging(logger);

    process.send?.({
      type: 'cluster:worker:ready',
      workerId,
    } satisfies WorkerReadyMessage);
    logger.info?.(`[rxpress] worker ${workerId} reported ready to primary`);
    logger.info?.(`[rxpress] worker ${workerId} ready on ${hostname}:${port}`);
    return { server, port };
  }

  export function dispatchBroadcast(payload: unknown, options?: { traceContext?: SpanContext; excludeIds?: string[] }) {
    if (!normalizedConfig.enabled || !cluster.isPrimary) {
      return;
    }

    workerRegistry.forEach((worker) => {
      worker.send({
        type: 'cluster:wss:broadcast',
        payload: {
          data: payload,
          traceContext: options?.traceContext,
          excludeIds: options?.excludeIds,
        },
      } satisfies PrimaryBroadcastDispatchMessage);
    });
  }

  export async function stop() {
    await new Promise<void>((resolve) => {
      shutdownResolvers.push(resolve);

      if (!shuttingDown) {
        initiateShutdown();
      }
    });
  }
}

async function forkWorkers(logger: Logger) {
  const desired = normalizedConfig.workers;

  readyWorkers.clear();
  shutdownAcks.clear();
  workerRegistry.clear();
  readyResolver = null;

  cluster.removeAllListeners('exit');
  cluster.on('exit', (worker, code, signal) => {
    workerRegistry.delete(worker.id);
    readyWorkers.delete(worker.id);
    shutdownAcks.delete(worker.id);

    if (!shuttingDown && normalizedConfig.restartOnExit) {
      logger.warn?.(`[rxpress] worker ${worker.id} exited (code=${code} signal=${signal}); restarting`);
      const replacement = cluster.fork();
      registerWorker(replacement, logger);
    }
  });

  for (let index = 0; index < desired; index += 1) {
    const worker = cluster.fork();
    registerWorker(worker, logger);
  }

  await new Promise<void>((resolve) => {
    readyResolver = resolve;
    resolveIfReady();
  });
}

function registerWorker(worker: Worker, logger: Logger) {
  workerRegistry.set(worker.id, worker);

  worker.on('message', (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) {
      return;
    }

    const message = raw as WorkerPrimaryMessage;

    if ('source' in (message as Record<string, unknown>) && (message as { source?: unknown }).source === '_sio_adapter') {
      return;
    }

    if (typeof (message as { type?: unknown }).type === 'string' && (
      (message as { type: string }).type.startsWith('sticky:') || (message as { type: string }).type === 'cluster:worker:init-probe'
    )) {
      return;
    }

    switch (message.type) {
      case 'cluster:worker:ready': {
        const { workerId } = message as WorkerReadyMessage;
        readyWorkers.add(workerId);
        logger.info?.(`[rxpress] primary acknowledged worker ${workerId} ready`);
        resolveIfReady();
        break;
      }

      case 'cluster:shutdown:ack': {
        const { workerId } = message as WorkerShutdownAckMessage;
        shutdownAcks.add(workerId);
        EventService.emit({
          topic: 'SYS::CLUSTER::WORKER::SHUTDOWN',
          data: { workerId },
        });

        if (shutdownAcks.size === workerRegistry.size) {
          resolveShutdown();
        }

        break;
      }

      default:
        logger.warn?.('[rxpress] received unknown cluster message from worker', raw);
    }
  });
}

function wireWorkerMessaging(logger: Logger) {
  process.on('message', (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) {
      return;
    }

    const message = raw as PrimaryWorkerMessage;

    if (message.source === '_sio_adapter' || message.type.startsWith('sticky:')) {
      return;
    }

    switch (message.type) {
      case 'cluster:shutdown':
        handleClusterShutdown(logger);
        break;
      case 'cluster:wss:broadcast':
        if (!workerWss) {
          logger.warn?.('[rxpress] worker received broadcast without active websocket server');
          return;
        }

        workerWss.broadcast({
          payload: message.payload.data,
          traceContext: message.payload.traceContext,
          excludeIds: message.payload.excludeIds,
        });
        break;
      default:
        logger.warn?.('[rxpress] worker received unknown primary message', message);
    }
  });
}

function setupSignalHandlers(logger: Logger) {
  if (shuttingDown) {
    return;
  }

  const handler = (signal: GracefulSignal) => {
    logger.info?.(`[rxpress] primary received ${signal}; initiating graceful cluster shutdown`);
    initiateShutdown();
  };

  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}

function initiateShutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  workerRegistry.forEach((worker) => {
    worker.send({ type: 'cluster:shutdown' } satisfies PrimaryShutdownMessage);
  });

  if (!workerRegistry.size) {
    resolveShutdown();
  }
}

function handleClusterShutdown(logger: Logger) {
  const workerId = getCurrentWorkerId();
  logger.info?.(`[rxpress] worker ${workerId} shutting down gracefully`);

  workerWss?.close();
  workerWss = null;

  EventService.close();

  process.send?.({
    type: 'cluster:shutdown:ack',
    workerId,
  } satisfies WorkerShutdownAckMessage);
}

function resolveShutdown() {
  primaryServer?.close();
  primaryServer = null;
  shuttingDown = false;
  shutdownAcks.clear();
  readyResolver = null;

  while (shutdownResolvers.length) {
    const resolver = shutdownResolvers.pop();
    resolver?.();
  }
}

function getCurrentWorkerId(): number {
  const workerId = cluster.worker?.id;

  if (typeof workerId !== 'number') {
    throw new Error('cluster worker id is unavailable; ensure this is running inside a worker process');
  }

  return workerId;
}

function resolveIfReady() {
  if (readyResolver && readyWorkers.size === normalizedConfig.workers) {
    const resolver = readyResolver;
    readyResolver = null;
    resolver();
  }
}
