import opentelemetry, { DiagLogLevel as DiagLogLevel_ } from '@opentelemetry/api';

export type Context = opentelemetry.Context;
export type DiagLogLevel = DiagLogLevel_;
export type MetricsConfig = {
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?: string;
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?: string;
  console_log?: {
    level: DiagLogLevel;
  };
  cpu?: {
    rateMs?: number;
  };
  node?: {
    rateMs?: number;
  };
  serviceName?: string;
};
export type MetricConfig = {
  type: 'counter' | 'histogram';
  name: string;
  description: string;
  unit: string;
}
