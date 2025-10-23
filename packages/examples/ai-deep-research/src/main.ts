import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { ConfigService, helpers, rxpress } from 'rxpress';
import type { MetricsConfig } from 'rxpress';
import { DiagLogLevel } from '@opentelemetry/api';
import cors from 'cors';
import dotenv from 'dotenv';

import { createPersistedKv } from './services/file-kv.service.js';

dotenv.config();

async function bootstrap() {
  const port = Number.parseInt(ConfigService.env('PORT', '3004'), 10);
  const hostname = ConfigService.env<string>('HOSTNAME', '127.0.0.1');
  
  const __dirname = ConfigService.getDirname(import.meta.url);
  const metricsEndpoint = ConfigService.env<string | undefined>('OTEL_EXPORTER_OTLP_METRICS_ENDPOINT', undefined);
  const tracesEndpoint = ConfigService.env<string | undefined>('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', undefined);
  const enableTelemetry = ConfigService.env<string>('OTEL_ENABLE', 'false') === 'true';
  const metricsConfig: MetricsConfig | undefined = enableTelemetry ? {
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: metricsEndpoint ?? 'http://localhost:4318/v1/metrics',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: tracesEndpoint ?? 'http://localhost:4318/v1/traces',
    console_log: {
      level: DiagLogLevel.ALL
    }
  } : undefined;

  const kv = createPersistedKv('ai-deep-research', __dirname);

  rxpress.init({
    config: {
      port,
      hostname: hostname,
      processHandlers: true,
      loadEnv: false,
      documentation: {
        enabled: true,
        title: 'AI Deep Research API',
        version: '0.1.0',
        description: 'Deep research pipeline powered by rxpress',
        path: '/openapi.json'
      },
      ...(metricsConfig ? { metrics: metricsConfig } : {})
    },
    logger: helpers.simplelLogger,
    kv
  });

  rxpress.use(cors());
  const eventsDir = join(__dirname, 'events');
  const apiDir = join(__dirname, 'api');
  const httpDir = join(__dirname, 'http');
  const handlerDirs = [
    eventsDir && existsSync(eventsDir) ? { eventDir: eventsDir } : null,
    apiDir && existsSync(apiDir) ? { handlerDir: apiDir } : null,
    httpDir && existsSync(httpDir) ? { handlerDir: httpDir } : null
  ].filter(Boolean) as Array<Record<string, string>>;

  for (const dir of handlerDirs) {
    await rxpress.load(dir);
  }

  const { server, port: boundPort } = await rxpress.start({ port });
  const addr = server.address();
  helpers.simplelLogger.info(`ai-deep-research example running on http://localhost:${boundPort}`, {addr});
}

bootstrap().catch(async (error) => {
  helpers.simplelLogger.error('Fatal error starting ai-deep-research', { error });
  await rxpress.stop(true);
  process.exit(1);
});
