import opentelemetry, { metrics, diag, DiagConsoleLogger, Counter, Histogram, context } from '@opentelemetry/api';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { defaultResource, resourceFromAttributes, Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

import { MetricConfig, MetricsConfig } from '../types/metrics.types.js';
import { ConfigService } from './config.service.js';

const CPU_MS = 5_000;
const DEFAULT_TRACE_HTTP_ENDPOINT = 'http://localhost:4318/v1/traces';

export namespace MetricService {
  let meterProvider: MeterProvider | undefined;
  let tracerProvider: NodeTracerProvider | undefined;
  let resource: Resource = defaultResource();
  let currentServiceName = 'rxpress-server';
  const meters: Record<string, Histogram | Counter> = {};
  let readyResolve: (() => void) | undefined;
  let tracer: opentelemetry.Tracer | undefined;
  export let ready$ = Promise.resolve();
  export let enabled = false;

  let instrumentationRegistered = false;

  // load runs as part of bootstrap to patch express/http before user-land imports
  export function load() {
    if (instrumentationRegistered) {
      return;
    }

    registerInstrumentations({
      instrumentations: [
        // Express instrumentation expects HTTP layer to be instrumented
        new HttpInstrumentation(),
        new ExpressInstrumentation(),
      ],
    });

    instrumentationRegistered = true;
  }

  export function start(param: MetricsConfig) {
    if (meterProvider) {
      return;
    }

    setReadyPending();

    const {
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = 'http://localhost:4318/v1/metrics',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
      console_log,
      cpu,
      serviceName,
    } = param;

    if (console_log?.level) {
      diag.setLogger(new DiagConsoleLogger(), console_log.level);
    }

    currentServiceName = serviceName || process.env.OTEL_SERVICE_NAME || currentServiceName;
    resource = defaultResource().merge(resourceFromAttributes({
      [ATTR_SERVICE_NAME]: currentServiceName,
    }));

    const metricExporter = new OTLPMetricExporter({
      url: OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    });

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: cpu?.rateMs ?? CPU_MS,
    });

    meterProvider = new MeterProvider({
      resource,
      readers: [metricReader],
    });

    metrics.setGlobalMeterProvider(meterProvider);

    tracerProvider?.shutdown().catch(() => undefined);
    const traceExporter = new OTLPTraceExporter({
      url: resolveTraceEndpoint(OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, OTEL_EXPORTER_OTLP_METRICS_ENDPOINT),
    });
    tracerProvider = new NodeTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(traceExporter)],
    });
    tracerProvider.register();

    tracer = undefined;

    readyResolve?.();
    readyResolve = undefined;
    enabled = true;
  }

  export function addMetrics<T>(metric: MetricConfig) {
    if (meterProvider) {
      const meter = metrics.getMeter('rxpress');

      switch (metric.type) {
        case 'counter':
          meters[metric.name] = meter.createCounter(metric.name, { description: metric.description, unit: metric.unit });
          break;
        case 'histogram':
          meters[metric.name] = meter.createHistogram(metric.name, { description: metric.description, unit: metric.unit });
          break;
      }
    }

    return meters[metric.name] as T;
  }

  export function getServiceName(): string {
    return currentServiceName;
  }

  export function getTracer() {
    if (!tracer) {
      tracer = opentelemetry.trace.getTracer(
        currentServiceName,
        `${ConfigService.pkg()['version']}`,
      );
    }

    return tracer;
  }

  export function getContext() {
    return context;
  }

  export async function stop() {
    if (!meterProvider) {
      return;
    }

    await meterProvider.shutdown();
    meterProvider = undefined;
    await tracerProvider?.shutdown().catch(() => undefined);
    tracerProvider = undefined;
    tracer = undefined;
    ready$ = Promise.resolve();
    readyResolve = undefined;
  }

  function setReadyPending() {
    ready$ = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });
  }

  function resolveTraceEndpoint(explicitEndpoint: string | undefined, metricsEndpoint: string | undefined): string {
    const candidates = [
      explicitEndpoint,
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
      deriveTraceEndpointFromMetrics(metricsEndpoint),
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    ];

    for (const candidate of candidates) {
      const normalized = normalizeTraceEndpoint(candidate);
      
      if (normalized) {
        return normalized;
      }
    }

    return DEFAULT_TRACE_HTTP_ENDPOINT;
  }

  function normalizeTraceEndpoint(endpoint: string | undefined): string | undefined {
    if (!endpoint) {
      return undefined;
    }

    if (endpoint.startsWith('unix://')) {
      return endpoint.endsWith('/v1/traces') ? endpoint : `${endpoint.replace(/\/$/, '')}/v1/traces`;
    }

    const value = endpoint.includes('://') ? endpoint : `http://${endpoint}`;

    try {
      const url = new URL(value);

      if (!url.port) {
        url.port = url.protocol === 'https:' ? '443' : '4318';
      }

      if (!url.pathname || url.pathname === '/') {
        url.pathname = '/v1/traces';
      }
      else if (!url.pathname.endsWith('/v1/traces')) {
        if (url.pathname.endsWith('/v1/metrics')) {
          url.pathname = url.pathname.replace('/v1/metrics', '/v1/traces');
        }
        else {
          url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/traces`;
        }
      }

      url.search = '';
      url.hash = '';

      return url.toString();
    }
    catch {
      return undefined;
    }
  }

  function deriveTraceEndpointFromMetrics(metricsEndpoint: string | undefined): string | undefined {
    if (!metricsEndpoint) {
      return undefined;
    }

    if (metricsEndpoint.startsWith('unix://')) {
      return metricsEndpoint.replace(/\/v1\/metrics$/, '/v1/traces');
    }

    if (metricsEndpoint.includes('/v1/metrics')) {
      return metricsEndpoint.replace('/v1/metrics', '/v1/traces');
    }

    return metricsEndpoint;
  }
}
