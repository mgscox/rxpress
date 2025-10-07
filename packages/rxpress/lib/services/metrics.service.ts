import { metrics, diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { HostMetrics } from '@opentelemetry/host-metrics';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

import { MetricsConfig } from '../types/metrics.types';
import { NodeSDK } from '@opentelemetry/sdk-node';

const CPU_MS = 5000;
const NODE_MS = 5000;

export namespace MetricService {
    var meterProvider: MeterProvider;
    var sdk: NodeSDK;
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

        // Configure the OTLP exporter to send data to your OpenTelemetry Collector
        const metricExporter = new OTLPMetricExporter({
            url: OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
        });

        // Configure the MeterProvider to periodically export metrics
        const metricReader = new PeriodicExportingMetricReader({
            exporter: metricExporter,
            exportIntervalMillis: cpu?.rateMs || CPU_MS, 
        });

        meterProvider = new MeterProvider({
            readers: [metricReader],
        });

        // Register the meter provider globally
        metrics.setGlobalMeterProvider(meterProvider);

        // Automatically collect host and process metrics, including CPU usage
        const hostMetrics = new HostMetrics({ meterProvider });
        hostMetrics.start();

        sdk = new NodeSDK({
            metricReader: new PeriodicExportingMetricReader({
                exporter: metricExporter,
                exportIntervalMillis: node?.rateMs || NODE_MS,
            }),
            instrumentations: [
                // Automatically loads all instrumentations available in the Node auto-instrumentations package
                getNodeAutoInstrumentations(),
                // Specifically add the runtime metrics instrumentation
                new RuntimeNodeInstrumentation(),
            ],
        });

        sdk.start()
    }
    export async function stop() {
        const promises = [];
        for (const telemetry of [sdk, meterProvider]) {
            if (telemetry && telemetry.shutdown) {
                promises.push(telemetry.shutdown());
            } 
        }
        return await Promise.all(promises);
    }
}
