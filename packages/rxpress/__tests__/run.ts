const tests = [
  './rxpress.test.ts',
  './rxpress.integration.test.ts',
  './rxpress.sse.test.ts',
  './rxpress.cron.test.ts',
  './readme-example.test.ts',
];

async function run() {
  for (const test of tests) {
    // Sequential imports keep side effects ordered (e.g., server start/stop).
    await import(test);
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
