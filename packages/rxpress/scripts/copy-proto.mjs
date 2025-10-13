import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = join(currentDir, '../src/grpc/handler_bridge.proto');
const destinationDir = join(currentDir, '../dist/grpc');
const destination = join(destinationDir, 'handler_bridge.proto');

mkdirSync(destinationDir, { recursive: true });
copyFileSync(source, destination);
