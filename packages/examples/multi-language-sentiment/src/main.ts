import { ConfigService, helpers, rxpress } from 'rxpress';
import type { MetricsConfig } from 'rxpress';
import { DiagLogLevel } from '@opentelemetry/api';
import cors from 'cors';
import dotenv from 'dotenv';

import sentimentRoute from './api/sentiment.handler.js';
import uiHandler from './http/index.handler.js';

dotenv.config();

async function bootstrap() {
  const port = Number.parseInt(ConfigService.env('PORT', '3004'), 10);
  const metricsEndpoint = ConfigService.env<string | undefined>('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT');
  const tracesEndpoint = ConfigService.env<string | undefined>('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT');
  const enableTelemetry = ConfigService.env<string>('OTEL_ENABLE', 'false') === 'true';
  const metricsConfig: MetricsConfig | undefined = enableTelemetry ? {
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: metricsEndpoint ?? 'http://localhost:4318/v1/metrics',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: tracesEndpoint ?? 'http://localhost:4318/v1/traces',
    console_log: {
      level: DiagLogLevel.ALL,
    },
  } : undefined;

  const grpcHost = ConfigService.env('GRPC_HOST', '127.0.0.1');
  const grpcPort = ConfigService.env('GRPC_PORT', '50055');
  const grpcBridgeBind = ConfigService.env('GRPC_BRIDGE_BIND', '127.0.0.1:50070');

  rxpress.init({
    config: {
      port,
      hostname: '0.0.0.0',  // ensure accessable over LAN
      processHandlers: true,
      loadEnv: false,
      documentation: {
        enabled: true,
        title: 'Multi-language Sentiment API',
        version: '0.1.0',
        description: 'Sentiment analysis via rxpress + Python gRPC bridge',
        path: '/openapi.json',
      },
      ...(metricsConfig ? { metrics: metricsConfig } : {}),
      grpc: {
        bind: grpcBridgeBind,
        registry: {
          'python-sentiment': {
            endpoints: [
              { target: `${grpcHost}:${grpcPort}` },
            ],
          },
        },
      },
    },
    logger: helpers.simplelLogger,
    kv: helpers.createMemoryKv('multi-language-sentiment', false),
  });

  rxpress.use(cors());
  rxpress.addHandlers([uiHandler, sentimentRoute]);

  const { port: boundPort } = await rxpress.start({ port });
  helpers.simplelLogger.info(`multi-language-sentiment example running on http://localhost:${boundPort}`);
}

bootstrap().catch(async (error) => {
  helpers.simplelLogger.error('Fatal error starting multi-language-sentiment', { error });
  await rxpress.stop(true);
  process.exit(1);
});
