import { metrics, diag, DiagConsoleLogger } from '@opentelemetry/api';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { HostMetrics } from '@opentelemetry/host-metrics';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';

import { MetricsConfig } from '../types/metrics.types.js';

const CPU_MS = 5000;
const NODE_MS = 5000;

export namespace MetricService {
  let meterProvider: MeterProvider | undefined;
  let sdk: NodeSDK | undefined;

  export function start(param: MetricsConfig) {
    const {
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = 'http://localhost:4318/v1/metrics',
      console_log,
      cpu,
      node,
    } = param;

    if (console_log?.level) {
      diag.setLogger(new DiagConsoleLogger(), console_log.level);
    }

    const metricExporter = new OTLPMetricExporter({
      url: OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    });

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: cpu?.rateMs || CPU_MS,
    });

    meterProvider = new MeterProvider({
      readers: [metricReader],
    });

    metrics.setGlobalMeterProvider(meterProvider);

    const hostMetrics = new HostMetrics({ meterProvider });
    hostMetrics.start();

    sdk = new NodeSDK({
      metricReader: new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: node?.rateMs || NODE_MS,
      }),
      instrumentations: [getNodeAutoInstrumentations(), new RuntimeNodeInstrumentation()],
    });

    sdk.start();
  }

  export async function stop() {
    const promises: Array<Promise<unknown>> = [];

    for (const telemetry of [sdk, meterProvider]) {
      if (telemetry && 'shutdown' in telemetry && typeof telemetry.shutdown === 'function') {
        promises.push(telemetry.shutdown());
      }
    }

    await Promise.all(promises);
  }
}
