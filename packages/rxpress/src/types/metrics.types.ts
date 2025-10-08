import { DiagLogLevel as DiagLogLevel_ } from '@opentelemetry/api';
export type DiagLogLevel = DiagLogLevel_;
export type MetricsConfig = {
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?: string;
  console_log?: {
    level: DiagLogLevel;
  };
  cpu?: {
    rateMs?: number;
  };
  node?: {
    rateMs?: number;
  };
};
