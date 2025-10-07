const tests = [
  './rxpress.test.ts',
  './rxpress.integration.test.ts',
  './rxpress.cron.test.ts',
];

for (const test of tests) {
  await import(test);
}
