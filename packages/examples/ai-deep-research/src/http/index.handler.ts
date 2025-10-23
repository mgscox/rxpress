import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { RPCConfig } from 'rxpress';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(__dirname, '..', '..', 'public', 'index.html');

const handler: RPCConfig = {
  type: 'http',
  method: 'GET',
  path: '/',
  name: 'Web UI entrypoint',
  description: 'Serve the deep research dashboard',
  handler: async () => {
    const html = await readFile(htmlPath, { encoding: 'utf-8' });
    return {
      status: 200,
      body: html,
      mime: 'text/html'
    };
  }
};

export default handler;
