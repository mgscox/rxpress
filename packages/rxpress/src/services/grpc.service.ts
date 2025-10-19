import { existsSync, readFileSync } from 'node:fs';
import { promises as fsPromises } from 'fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import crypto, { createHash } from 'node:crypto';

import { globSync } from 'glob';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { SpanContext } from '@opentelemetry/api';
import { TraceFlags } from '@opentelemetry/api';

import type { Logger } from '../types/logger.types.js';
import type { KVBase } from '../types/kv.types.js';
import type { Emit } from '../types/emit.types.js';
import type { GrpcConfig, GrpcDiscoveryConfig, GrpcEndpointConfig, GrpcHealthCheckConfig, GrpcInvokeBinding, GrpcLocalHandler, GrpcRegistryEntry, GrpcTlsConfig } from '../types/grpc.types.js';
import { createKVPath } from './kv-path.service.js';
import { getRun } from './run.service.js';

const DEFAULT_BIND_ADDRESS = '0.0.0.0:50051';
const DEFAULT_PACKAGE = 'bridge';

const loaderOptions: protoLoader.Options = {
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  keepCase: false,
};

type InvokeResult = {
  output: Record<string, unknown>;
  status: { code: number; message?: string };
};

type ResolvedBinding = {
  handlerName: string;
  endpoints: ResolvedEndpoint[];
};

type ResolvedEndpoint = {
  target?: string;
  metadata?: Record<string, string>;
  timeoutMs?: number;
  backoffMs?: number;
  credentials?: grpc.ChannelCredentials;
  credentialsKey?: string;
  healthCheck?: GrpcHealthCheckConfig;
};

type Timeout = ReturnType<typeof setTimeout>;

type State = {
  initialized: boolean;
  config?: GrpcConfig;
  logger?: Logger;
  kv?: KVBase;
  emit?: Emit;
  protoPath?: string;
  grpcPackage?: any;
  server?: grpc.Server;
  localHandlers: Map<string, GrpcLocalHandler>;
  target?: string;
  invokers: Map<string, any>;
  ready?: Promise<void>;
  defaultCredentials: grpc.ChannelCredentials;
  defaultCredentialsKey: string;
  discoveredEndpoints: Map<string, GrpcEndpointConfig[]>;
  discoveryTimers: Map<string, Timeout>;
};

const state: State = {
  initialized: false,
  localHandlers: new Map(),
  invokers: new Map(),
  defaultCredentials: grpc.credentials.createInsecure(),
  defaultCredentialsKey: 'insecure',
  discoveredEndpoints: new Map(),
  discoveryTimers: new Map(),
};

const failureTimestamps = new Map<string, number>();
const credentialsCache = new Map<string, grpc.ChannelCredentials>();
const endpointProbes = new Map<string, Timeout>();
const endpointHealth = new Map<string, boolean>();

const bucketKey = (bucket: string, key: string) => `${bucket}:${key}`;

const resolveTraceContext = (meta: Record<string, unknown> | undefined): SpanContext | undefined => {
  if (!meta) {
    return undefined;
  }

  const traceId = typeof meta.trace_id === 'string' ? meta.trace_id : undefined;
  const spanId = typeof meta.span_id === 'string' ? meta.span_id : undefined;

  if (!traceId || !spanId) {
    return undefined;
  }

  const traceFlagsValue = typeof meta.trace_flags === 'number' ? Number(meta.trace_flags) : TraceFlags.SAMPLED;

  return {
    traceId,
    spanId,
    traceFlags: traceFlagsValue,
    isRemote: true,
  };
};

function resolveProtoPath(config?: GrpcConfig): string {
  if (config?.protoPath) {
    return config.protoPath;
  }

  const distPath = fileURLToPath(new URL('../grpc/handler_bridge.proto', import.meta.url));

  if (existsSync(distPath)) {
    return distPath;
  }

  // fallback to source for local development
  const srcPath = fileURLToPath(new URL('../../src/grpc/handler_bridge.proto', import.meta.url));
  return srcPath;
}

function encodeValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return { json: JSON.stringify(value ?? null) };
  }

  if (Buffer.isBuffer(value)) {
    return { bin: value };
  }

  switch (typeof value) {
    case 'string':
      return { s: value };
    case 'number':
      if (Number.isInteger(value)) {
        return { i64: value };
      }

      return { f64: value };
    case 'boolean':
      return { b: value };

    case 'object':
      try {
        return { json: JSON.stringify(value) };
      }
      catch {
        return { json: JSON.stringify({}) };
      }

    default:
      return { json: JSON.stringify(value) };
  }
}

function decodeValue(record: Record<string, unknown> | undefined): unknown {
  if (!record) {
    return undefined;
  }

  if ('json' in record && typeof record.json === 'string') {
    try {
      return JSON.parse(record.json);
    }
    catch {
      return record.json;
    }
  }

  if ('s' in record) {
    return record.s;
  }

  if ('b' in record) {
    return record.b;
  }

  if ('i64' in record) {
    const value = record.i64 as string | number;
    return typeof value === 'string' ? Number(value) : value;
  }

  if ('f64' in record) {
    return record.f64;
  }

  if ('bin' in record) {
    return record.bin;
  }

  return undefined;
}

function toProtoMap(payload: Record<string, unknown> | undefined): Record<string, Record<string, unknown>> {
  if (!payload) {
    return {};
  }

  return Object.entries(payload).reduce<Record<string, Record<string, unknown>>>((acc, [key, value]) => {
    acc[key] = encodeValue(value);
    return acc;
  }, {});
}

function fromProtoMap(map: Record<string, Record<string, unknown>> | undefined): Record<string, unknown> {
  if (!map) {
    return {};
  }

  return Object.entries(map).reduce<Record<string, unknown>>((acc, [key, value]) => {
    acc[key] = decodeValue(value);
    return acc;
  }, {});
}

function ensureInitialized(): void {
  if (!state.initialized || !state.grpcPackage) {
    throw new Error('gRPC bridge not initialised – enable `config.grpc` before using kind:"grpc" handlers.');
  }
}

function loadHandlersFromModule(module: Record<string, unknown>, source: string): GrpcLocalHandler[] {
  const handlers: GrpcLocalHandler[] = [];

  const register = (name: string | undefined, candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') {
      return;
    }

    const invoke = (candidate as Record<string, unknown>).invoke;
    const explicitName = typeof (candidate as Record<string, unknown>).name === 'string'
      ? (candidate as Record<string, unknown>).name as string
      : undefined;
    const handlerName = name ?? explicitName;

    if (!handlerName || typeof invoke !== 'function') {
      state.logger?.warn?.('Skipping invalid gRPC handler export', { source, candidate: name ?? explicitName ?? 'unknown' });
      return;
    }

    handlers.push({ name: handlerName, invoke: invoke as GrpcLocalHandler['invoke'] });
  };

  const namedExports = ['handler', 'default'];

  for (const key of namedExports) {
    if (Object.prototype.hasOwnProperty.call(module, key)) {
      const value = module[key as keyof typeof module];

      if (Array.isArray(value)) {
        value.forEach((entry, index) => register(undefined, { ...entry, name: (entry as Record<string, unknown>)?.name ?? `${key}_${index}` }));
      }
      else {
        register(undefined, value);
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(module, 'handlers')) {
    const value = module.handlers;

    if (value && typeof value === 'object') {
      for (const [name, fn] of Object.entries(value as Record<string, unknown>)) {
        register(name, fn);
      }
    }
  }

  return handlers;
}

async function loadLocalHandlers(localHandlers?: string | string[]): Promise<void> {
  state.localHandlers.clear();

  if (!localHandlers) {
    return;
  }

  const patterns = Array.isArray(localHandlers) ? localHandlers : [localHandlers];

  for (const pattern of patterns) {
    const files = globSync(pattern, { absolute: true, nodir: true });

    for (const file of files) {
      const mod = await import(pathToFileURL(file).href);
      const handlers = loadHandlersFromModule(mod as Record<string, unknown>, file);

      for (const handler of handlers) {
        state.localHandlers.set(handler.name, handler);
      }
    }
  }
}

function handlerContextFactory(meta: Record<string, unknown> | undefined) {
  const logger = state.logger;
  const kv = state.kv;
  const emit = state.emit;

  if (!logger || !kv || !emit) {
    throw new Error('gRPC handler context requested before bridge initialised.');
  }

  const kvPath = createKVPath(kv);
  const runId = meta && typeof meta.run_id === 'string' ? meta.run_id : undefined;
  const run = runId ? getRun(runId) : undefined;

  return {
    logger,
    kv,
    kvPath,
    emit,
    log: (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => {
      const map = {
        info: logger.info,
        warn: logger.warn,
        error: logger.error,
      } as const;
      const fn = map[level] ?? logger.info;
      fn.call(logger, message, fields);
    },
    run,
    meta,
  };
}

async function startServer(): Promise<void> {
  if (!state.grpcPackage) {
    return;
  }

  const bindAddress = state.config?.bind ?? DEFAULT_BIND_ADDRESS;
  const server = new grpc.Server();

  const controlImpl = {
    Connect(call: grpc.ServerDuplexStream<any, any>) {
      call.on('data', async (message: any) => {
        const correlation = message?.correlation ?? crypto.randomUUID();

        const respond = (payload: Record<string, unknown>) => {
          call.write({ correlation, ...payload });
        };

        const meta = (message?.meta ?? {}) as Record<string, unknown>;
        const runId = typeof meta.run_id === 'string' ? meta.run_id : undefined;
        const run = runId ? getRun(runId) : undefined;
        const traceContext = resolveTraceContext(meta);

        try {
          if (message?.log) {
            const { level = 'info', msg, fields } = message.log;
            const lvl = ['info', 'warn', 'error', 'debug'].includes(level) ? level : 'info';
            const metaFields = fromProtoMap(fields);

            if (runId) {
              metaFields.runId = runId;
            }

            state.logger?.[lvl as 'info' | 'warn' | 'error' | 'debug']?.(msg, metaFields);
            return;
          }

          if (message?.emit) {
            const data = fromProtoMap(message.emit.data);
            state.emit?.({ topic: message.emit.topic, data, run, traceContext });
            respond({ kv_common_res: { status: { code: 0 } } });
            return;
          }

          if (message?.kv_get) {
            const key = bucketKey(message.kv_get.bucket, message.kv_get.key);
            const value = await state.kv?.get(key);
            respond({ kv_get_res: { status: { code: 0 }, value: encodeValue(value) } });
            return;
          }

          if (message?.kv_put) {
            const key = bucketKey(message.kv_put.bucket, message.kv_put.key);
            const value = decodeValue(message.kv_put.value);
            await state.kv?.set(key, value);
            respond({ kv_common_res: { status: { code: 0 } } });
            return;
          }

          if (message?.kv_del) {
            const key = bucketKey(message.kv_del.bucket, message.kv_del.key);
            await state.kv?.del(key);
            respond({ kv_common_res: { status: { code: 0 } } });
            return;
          }
        }
        catch (error) {
          respond({ kv_common_res: { status: { code: 1, message: (error as Error)?.message ?? 'grpc control error' } } });
        }
      });

      call.on('error', (error: unknown) => {
        state.config?.onError?.(error);
      });

      call.on('end', () => {
        call.end();
      });
    },
  } satisfies grpc.UntypedServiceImplementation;

  const invokerImpl = {
    async Invoke(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>) {
      const { handlerName, method, input, meta } = call.request ?? {};
      const correlation = call.request?.correlation ?? crypto.randomUUID();

      try {
        const handler = handlerName ? state.localHandlers.get(handlerName) : undefined;

        if (!handler) {
          callback(null, { correlation, status: { code: 1, message: `handler not found: ${handlerName}` } });
          return;
        }

        const ctx = handlerContextFactory(meta);
        const payload = fromProtoMap(input);
        const result = await handler.invoke(method, payload, meta ?? {}, ctx);
        const output = result ? toProtoMap(result) : {};
        callback(null, { correlation, status: { code: 0 }, output });
      }
      catch (error) {
        callback(null, { correlation, status: { code: 1, message: (error as Error)?.message ?? 'handler failed' } });
      }
    },
  } satisfies grpc.UntypedServiceImplementation;

  server.addService(state.grpcPackage.ControlPlane.service, controlImpl);
  server.addService(state.grpcPackage.Invoker.service, invokerImpl);

  await new Promise<void>((resolve, reject) => {
    server.bindAsync(bindAddress, grpc.ServerCredentials.createInsecure(), (error, port) => {
      if (error) {
        reject(error);
        return;
      }

      const host = bindAddress.includes(':') ? bindAddress.split(':')[0] : '0.0.0.0';
      const resolvedHost = host === '0.0.0.0' ? '127.0.0.1' : host;
      state.target = state.config?.target ?? `${resolvedHost}:${port}`;
      state.logger?.debug('gRPC bridge server listening', { target: state.target });
      resolve();
    });
  });

  state.server = server;
}

function mergeMetadata(...entries: Array<Record<string, string> | undefined>): Record<string, string> | undefined {
  const result: Record<string, string> = {};

  for (const entry of entries) {
    if (!entry) {
      continue;
    }

    for (const [key, value] of Object.entries(entry)) {
      result[key] = value;
    }
  }

  return Object.keys(result).length ? result : undefined;
}

type CredentialBundle = {
  credentials: grpc.ChannelCredentials;
  cacheKey: string;
};

function mergeTlsConfig(...configs: Array<GrpcTlsConfig | undefined>): GrpcTlsConfig | undefined {
  const result: GrpcTlsConfig = {};

  for (const cfg of configs) {
    if (!cfg) {
      continue;
    }

    if (cfg.caFile !== undefined) {
      result.caFile = cfg.caFile;
    }

    if (cfg.certFile !== undefined) {
      result.certFile = cfg.certFile;
    }

    if (cfg.keyFile !== undefined) {
      result.keyFile = cfg.keyFile;
    }

    if (cfg.insecure !== undefined) {
      result.insecure = cfg.insecure;
    }
  }

  return Object.keys(result).length ? result : undefined;
}

function mergeHealthConfig(...configs: Array<GrpcHealthCheckConfig | undefined>): GrpcHealthCheckConfig | undefined {
  const merged: GrpcHealthCheckConfig = {};

  for (const config of configs) {
    if (!config) {
      continue;
    }

    if (config.intervalMs !== undefined) {
      merged.intervalMs = config.intervalMs;
    }

    if (config.timeoutMs !== undefined) {
      merged.timeoutMs = config.timeoutMs;
    }
  }

  return Object.keys(merged).length ? merged : undefined;
}

function readFileBuffer(path?: string): Buffer | undefined {
  if (!path) {
    return undefined;
  }

  return readFileSync(path);
}

function createCredentialsBundle(tls?: GrpcTlsConfig): CredentialBundle | undefined {
  if (!tls) {
    return undefined;
  }

  if (tls.insecure) {
    return { credentials: grpc.credentials.createInsecure(), cacheKey: 'insecure' };
  }

  const ca = readFileBuffer(tls.caFile);
  const key = readFileBuffer(tls.keyFile);
  const cert = readFileBuffer(tls.certFile);

  const hash = createHash('sha256');
  if (ca) hash.update(ca);
  if (key) hash.update(key);
  if (cert) hash.update(cert);
  hash.update(Buffer.from([ca ? 1 : 0, key ? 1 : 0, cert ? 1 : 0]));
  const cacheKey = `ssl:${hash.digest('hex')}`;

  if (credentialsCache.has(cacheKey)) {
    return { credentials: credentialsCache.get(cacheKey)!, cacheKey };
  }

  const credentials = grpc.credentials.createSsl(ca, key, cert);
  credentialsCache.set(cacheKey, credentials);

  return {
    credentials,
    cacheKey,
  };
}

function resolveRegistryEntry(binding: GrpcInvokeBinding): ResolvedBinding {
  const registryKey = binding.service ?? binding.handlerName;
  const registryEntry: GrpcRegistryEntry | undefined = registryKey
    ? state.config?.registry?.[registryKey]
    : undefined;

  if (registryEntry?.discover) {
    startDiscoveryForService(registryKey, registryEntry.discover);
  }

  const endpoints = registryEntry?.endpoints ?? [];
  const discovered = state.discoveredEndpoints.get(registryKey) ?? [];

  const sources: Array<GrpcEndpointConfig | undefined> = (endpoints.length ? endpoints : [undefined]).concat(discovered);
  const combined: ResolvedEndpoint[] = sources.map((endpoint) => {
    const mergedTls = mergeTlsConfig(
      state.config?.tls,
      registryEntry?.tls,
      endpoint?.tls,
      binding.tls,
    );
    const bundle = createCredentialsBundle(mergedTls);

    const healthCheck = mergeHealthConfig(
      state.config?.healthCheck,
      registryEntry?.healthCheck,
      endpoint?.healthCheck,
      binding.healthCheck,
    );

    return {
      target: endpoint?.target ?? registryEntry?.target ?? binding.target,
      timeoutMs: endpoint?.timeoutMs ?? registryEntry?.timeoutMs ?? binding.timeoutMs,
      metadata: mergeMetadata(registryEntry?.metadata, endpoint?.metadata, binding.metadata),
      backoffMs: endpoint?.backoffMs ?? registryEntry?.backoffMs,
      credentials: bundle?.credentials,
      credentialsKey: bundle?.cacheKey ?? 'custom',
      healthCheck,
    };
  });

  combined.forEach(ensureProbe);

  return {
    handlerName: binding.handlerName,
    endpoints: combined,
  };
}

function getInvoker(endpoint: ResolvedEndpoint) {
  ensureInitialized();
  const finalTarget = endpoint.target ?? state.target ?? state.config?.target;

  if (!finalTarget) {
    throw new Error('gRPC bridge target unresolved – set `config.grpc.target` or `config.grpc.bind`.');
  }

  const bundle = endpoint.credentials
    ? { credentials: endpoint.credentials, cacheKey: endpoint.credentialsKey ?? 'custom' }
    : { credentials: state.defaultCredentials, cacheKey: state.defaultCredentialsKey };

  const key = getEndpointKey(finalTarget, bundle.cacheKey);

  if (!state.invokers.has(key)) {
    const InvokerConstructor = state.grpcPackage.Invoker;
    state.invokers.set(key, new InvokerConstructor(finalTarget, bundle.credentials));
  }

  return state.invokers.get(key);
}

function getEndpointKey(target?: string, credentialsKey = 'insecure'): string {
  return `${target ?? ''}|${credentialsKey}`;
}

function isEndpointHealthy(endpoint: ResolvedEndpoint): boolean {
  const key = getEndpointKey(endpoint.target, endpoint.credentialsKey);

  if (endpoint.healthCheck) {
    const health = endpointHealth.get(key);

    if (health === false) {
      return false;
    }
  }

  const failureAt = failureTimestamps.get(key);

  if (!failureAt) {
    return true;
  }

  const backoff = endpoint.backoffMs ?? 30_000;
  return (Date.now() - failureAt) > backoff;
}

function markEndpointFailure(endpoint: ResolvedEndpoint): void {
  const key = getEndpointKey(endpoint.target, endpoint.credentialsKey);
  failureTimestamps.set(key, Date.now());
}

function clearEndpointFailure(endpoint: ResolvedEndpoint): void {
  const key = getEndpointKey(endpoint.target, endpoint.credentialsKey);
  failureTimestamps.delete(key);
}

const RETRIABLE_CODES = new Set([grpc.status.UNAVAILABLE, grpc.status.DEADLINE_EXCEEDED, grpc.status.CANCELLED, grpc.status.UNKNOWN]);

function shouldRetry(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = (error as grpc.ServiceError).code;
  return typeof code === 'number' && RETRIABLE_CODES.has(code);
}

function ensureProbe(endpoint: ResolvedEndpoint): void {
  if (!endpoint.healthCheck || !endpoint.target) {
    return;
  }

  const key = getEndpointKey(endpoint.target, endpoint.credentialsKey);

  if (endpointProbes.has(key)) {
    return;
  }

  const intervalMs = endpoint.healthCheck.intervalMs ?? 30_000;
  const runProbe = () => probeEndpoint(endpoint, key);

  runProbe();
  const timer = setInterval(runProbe, intervalMs);
  endpointProbes.set(key, timer);
}

function probeEndpoint(endpoint: ResolvedEndpoint, key: string): void {
  const timeout = endpoint.healthCheck?.timeoutMs ?? 5_000;
  const client = getInvoker(endpoint);
  const deadline = new Date(Date.now() + timeout);

  client.waitForReady(deadline, (error: Error | null) => {
    if (error) {
      endpointHealth.set(key, false);
      markEndpointFailure(endpoint);
      state.logger?.warn?.('gRPC endpoint probe failed', { target: endpoint.target, error: `${error}` });
      return;
    }

    endpointHealth.set(key, true);
    clearEndpointFailure(endpoint);
  });
}

function clearHealthProbes(): void {
  endpointProbes.forEach((timer) => clearInterval(timer));
  endpointProbes.clear();
  endpointHealth.clear();
  failureTimestamps.clear();
}

function startDiscoveryForService(service: string, discover: GrpcDiscoveryConfig): void {
  if (state.discoveryTimers.has(service)) {
    return;
  }

  switch (discover.type) {
    case 'file':
      scheduleFileDiscovery(service, discover);
      break;
    default:
      state.logger?.warn?.('Unsupported discovery type', { service, type: discover.type });
  }
}

function scheduleFileDiscovery(service: string, discover: Extract<GrpcDiscoveryConfig, { type: 'file' }>): void {
  const interval = discover.intervalMs ?? 10_000;

  const refresh = async () => {
    try {
      const raw = await fsPromises.readFile(discover.path, 'utf8');
      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        state.logger?.warn?.('Discovery file did not contain an array', { service, path: discover.path });
        return;
      }

      const endpoints: GrpcEndpointConfig[] = parsed.map((entry: any) => normalizeDiscoveredEndpoint(entry)).filter((entry): entry is GrpcEndpointConfig => Boolean(entry?.target));
      state.discoveredEndpoints.set(service, endpoints);
    }
    catch (error) {
      state.logger?.warn?.('Failed to refresh discovery endpoints', { service, error: `${error}` });
    }
  };

  refresh().catch(() => {});
  const timer = setInterval(() => {
    refresh().catch(() => {});
  }, interval);
  state.discoveryTimers.set(service, timer);
}

function normalizeDiscoveredEndpoint(entry: any): GrpcEndpointConfig | undefined {
  if (typeof entry === 'string') {
    return { target: entry };
  }

  if (entry && typeof entry === 'object') {
    const target = typeof entry.target === 'string' ? entry.target : undefined;
    const metadata = typeof entry.metadata === 'object' && entry.metadata ? entry.metadata as Record<string, string> : undefined;
    const timeoutMs = typeof entry.timeoutMs === 'number' ? entry.timeoutMs : undefined;
    const backoffMs = typeof entry.backoffMs === 'number' ? entry.backoffMs : undefined;
    return target ? { target, metadata, timeoutMs, backoffMs } : undefined;
  }

  return undefined;
}

function clearDiscovery(): void {
  state.discoveryTimers.forEach((timer) => clearInterval(timer));
  state.discoveryTimers.clear();
  state.discoveredEndpoints.clear();
}

async function shutdownServer(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (!state.server) {
      resolve();
      return;
    }

    state.server.tryShutdown(() => {
      resolve();
    });
  });

  state.server = undefined;
}

export namespace GrpcBridgeService {
  export function init(params: { config?: GrpcConfig; logger: Logger; kv: KVBase; emit: Emit }): void {
    const { config, logger, kv, emit } = params;

    state.logger = logger;
    state.kv = kv;
    state.emit = emit;
    state.config = config;

    const initialise = async () => {
      if (state.ready) {
        try {
          await state.ready;
        }
        catch {
          // previous initialisation failure already reported
        }
      }

      await shutdownServer();
      clearHealthProbes();
      clearDiscovery();
      state.invokers.forEach((client) => {
        if (typeof client.close === 'function') {
          client.close();
        }
      });
      state.invokers.clear();
      state.localHandlers.clear();
      state.initialized = false;

      if (!config) {
        state.grpcPackage = undefined;
        state.target = undefined;
        state.defaultCredentials = grpc.credentials.createInsecure();
        state.defaultCredentialsKey = 'insecure';
        clearDiscovery();
        return;
      }

      state.protoPath = resolveProtoPath(config);
      const packageDefinition = protoLoader.loadSync(state.protoPath, loaderOptions);
      const grpcPackage = grpc.loadPackageDefinition(packageDefinition);

      const packageName = config.packageName ?? DEFAULT_PACKAGE;
      const resolvedPackage = (grpcPackage as Record<string, unknown>)[packageName];

      if (!resolvedPackage) {
        throw new Error(`gRPC bridge package "${packageName}" not found in proto definition.`);
      }

      state.grpcPackage = resolvedPackage;

      const defaultBundle = createCredentialsBundle(config.tls) ?? {
        credentials: grpc.credentials.createInsecure(),
        cacheKey: 'insecure',
      };
      state.defaultCredentials = defaultBundle.credentials;
      state.defaultCredentialsKey = defaultBundle.cacheKey;

      await loadLocalHandlers(config.localHandlers);

      const needsServer = Boolean(config.bind || config.localHandlers || !config.target);

      if (needsServer) {
        await startServer();
      }
      else {
        state.target = config.target;
      }

      console.debug(`[gRPC] state.target`, state.target)
      state.initialized = true;
    };

    state.ready = initialise().catch((error) => {
      state.initialized = false;
      state.config?.onError?.(error);
      state.logger?.error?.('gRPC bridge initialisation failed', { error: `${error instanceof Error ? error.message : error}` });
      throw error;
    });
  }

  export function isEnabled(): boolean {
    return state.initialized && !!state.grpcPackage;
  }

  export async function ready(): Promise<void> {
    if (state.ready) {
      await state.ready.catch(() => {});
    }
  }

  export async function invoke(param: { binding: GrpcInvokeBinding; method: string; input?: Record<string, unknown>; meta?: Record<string, unknown>; }): Promise<InvokeResult> {
    const { binding, method, input, meta } = param;

    if (state.ready) {
      await state.ready;
    }

    ensureInitialized();

    const resolved = resolveRegistryEntry(binding);
    state.logger?.debug?.('grpc.invoke.resolved', {
      handler: resolved.handlerName,
      endpoints: resolved.endpoints.map((endpoint) => ({ target: endpoint.target })),
    });
    const healthyEndpoints = resolved.endpoints.filter(isEndpointHealthy);
    const candidates = healthyEndpoints.length ? healthyEndpoints : resolved.endpoints;

    let lastError: unknown;

    for (const endpoint of candidates) {
      try {
        const result = await invokeOnce({ endpoint, binding: resolved, method, input, meta });
        clearEndpointFailure(endpoint);
        return result;
      }
      catch (error) {
        lastError = error;

        if (shouldRetry(error)) {
          markEndpointFailure(endpoint);
          continue;
        }

        throw error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('All gRPC endpoints failed for handler');
  }

  async function invokeOnce(params: { endpoint: ResolvedEndpoint; binding: ResolvedBinding; method: string; input?: Record<string, unknown>; meta?: Record<string, unknown> }): Promise<InvokeResult> {
    const { endpoint, binding, method, input, meta } = params;
    const client = getInvoker(endpoint);
    const correlation = crypto.randomUUID();

    const request = {
      handlerName: binding.handlerName,
      method,
      correlation,
      meta: meta ?? {},
      input: toProtoMap(input),
    };

    const metadata = new grpc.Metadata();

    if (endpoint.metadata) {
      for (const [key, value] of Object.entries(endpoint.metadata)) {
        metadata.set(key, value);
      }
    }

    const deadline = endpoint.timeoutMs ? Date.now() + endpoint.timeoutMs : undefined;
    const options = deadline ? { deadline: new Date(deadline) } : undefined;

    return new Promise<InvokeResult>((resolve, reject) => {
      const callback = (error: grpc.ServiceError | null, response: any) => {
        if (error) {
          const details = {
            target: endpoint.target ?? state.target ?? state.config?.target,
            code: (error as grpc.ServiceError).code,
            details: (error as grpc.ServiceError).details,
            message: error.message,
          };
          state.logger?.error?.('grpc.invoke.error', details);
          reject(error);
          return;
        }

        const status = response?.status ?? { code: 0 };

        if (status.code !== 0) {
          const details = {
            target: endpoint.target ?? state.target ?? state.config?.target,
            status,
          };
          state.logger?.error?.('grpc.invoke.status', details);
          console.error('[grpc.invoke.status]', details);
          const err = new Error(status.message ?? 'gRPC invocation failed');
          reject(err);
          return;
        }

        resolve({
          output: fromProtoMap(response?.output),
          status,
        });
      };

      if (options) {
        client.Invoke(request, metadata, options, callback);
      }
      else {
        client.Invoke(request, metadata, callback);
      }
    });
  }

  export async function shutdown(): Promise<void> {
    if (state.ready) {
      try {
        await state.ready;
      }
      catch {
        // swallow errors – shutdown will clean up
      }
    }

    await shutdownServer();
    clearHealthProbes();
    clearDiscovery();
    state.invokers.forEach((client) => {
      if (typeof client.close === 'function') {
        client.close();
      }
    });
    state.invokers.clear();
    state.localHandlers.clear();
    state.initialized = false;
    state.ready = Promise.resolve();
  }
}
