import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import type { RPCConfig } from 'rxpress';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const htmlPath = resolve(__dirname, '../../public/index.html');

const handler: RPCConfig = {
  type: 'http',
  method: 'GET',
  path: '/',
  name: 'Sentiment UI',
  description: 'Serve the sentiment demo UI',
  handler: async () => {
    const html = await readFile(htmlPath, { encoding: 'utf-8' });
    return {
      status: 200,
      body: html,
      mime: 'text/html',
    };
  },
};

export default handler;
