import path from 'node:path';

const tests = [
  './rxpress.test.ts',
  './rxpress.integration.test.ts',
  './rxpress.wss.test.ts',
  './rxpress.sse.test.ts',
  './rxpress.cron.test.ts',
  './rxpress.cron-retry.test.ts',
  './rxpress.static.test.ts',
  './rxpress.next.test.ts',
  './rxpress.documentation.test.ts',
  './rxpress.run-context.test.ts',
  './rxpress.reactive.test.ts',
  './rxpress.validate-events.test.ts',
  './rxpress.workbench.test.ts',
  './rxpress.grpc-health.test.ts',
  './rxpress.grpc-discovery.test.ts',
  './readme-example.test.ts',
];

const options = process.argv.slice(2) || []

async function run() {
  for (const test of tests) {
    if (!options.length || options.includes( path.basename(test) )) {
      // Sequential imports keep side effects ordered (e.g., server start/stop).
      await import(test);
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
