import type { Logger } from './logger.types.js';
import type { KVBase, KVPath } from './kv.types.js';
import type { Emit } from './emit.types.js';
import type { RunContext } from './run.types.js';
export type GrpcHealthCheckConfig = {
  intervalMs?: number;
  timeoutMs?: number;
};

export type GrpcDiscoveryFileConfig = {
  type: 'file';
  path: string;
  intervalMs?: number;
};

export type GrpcDiscoveryConfig = GrpcDiscoveryFileConfig;

export type GrpcTlsConfig = {
  caFile?: string;
  certFile?: string;
  keyFile?: string;
  insecure?: boolean;
};

export type GrpcEndpointConfig = {
  target?: string;
  metadata?: Record<string, string>;
  timeoutMs?: number;
  backoffMs?: number;
  tls?: GrpcTlsConfig;
  healthCheck?: GrpcHealthCheckConfig;
};

export type GrpcRegistryEntry = {
  target?: string;
  metadata?: Record<string, string>;
  timeoutMs?: number;
  backoffMs?: number;
  endpoints?: GrpcEndpointConfig[];
  tls?: GrpcTlsConfig;
  healthCheck?: GrpcHealthCheckConfig;
  discover?: GrpcDiscoveryConfig;
};

export type GrpcConfig = {
  /** Default gRPC endpoint (host:port) to reach handler orchestrators. */
  target?: string;
  /** Optional override package name when loading the bridge proto. Defaults to `bridge`. */
  packageName?: string;
  /** Relative or absolute path to the handler bridge proto. Defaults to the bundled asset. */
  protoPath?: string;
  /** Directory globs containing local handler modules to register with the in-process orchestrator. */
  localHandlers?: string | string[];
  /** Invoked when the bridge encounters an unexpected error. */
  onError?: (error: unknown) => void;
  /** When provided, starts an in-process gRPC server on this port for local handlers. */
  bind?: string;
  /** Registry of named endpoints so multiple targets can be addressed without repeating configuration. */
  registry?: Record<string, GrpcRegistryEntry>;
  /** TLS configuration applied to all outgoing connections unless overridden. */
  tls?: GrpcTlsConfig;
  /** Health check defaults, used for endpoints without explicit overrides. */
  healthCheck?: GrpcHealthCheckConfig;
  /** Discovery defaults applied when endpoints opt-in. */
  discover?: GrpcDiscoveryConfig;
};

export type GrpcInvokeBinding = {
  handlerName: string;
  target?: string;
  timeoutMs?: number;
  metadata?: Record<string, string>;
  /** Optional key to look up connection details from config.registry. */
  service?: string;
  /** Optional TLS override for this handler binding. */
  tls?: GrpcTlsConfig;
  /** Optional health check override for this handler binding. */
  healthCheck?: GrpcHealthCheckConfig;
};

export type GrpcHandlerContext = {
  logger: Logger;
  kv: KVBase;
  kvPath: KVPath;
  emit: Emit;
  log: (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;
  run?: RunContext;
  meta?: Record<string, unknown>;
};

export type GrpcLocalHandler = {
  name: string;
  invoke: (
    method: string,
    input: Record<string, unknown>,
    meta: Record<string, unknown>,
    ctx: GrpcHandlerContext,
  ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
};

export type GrpcLocalModule = {
  handler: GrpcLocalHandler | GrpcLocalHandler[];
} | GrpcLocalHandler | GrpcLocalHandler[];
