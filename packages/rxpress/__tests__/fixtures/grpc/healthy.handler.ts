import type { GrpcLocalHandler } from '../../../src/types/grpc.types.js';

export const handler: GrpcLocalHandler = {
  name: 'healthy-handler',
  async invoke(_method, input) {
    return {
      status: 200,
      body: {
        ok: true,
        source: 'healthy',
        echo: input,
      },
    };
  },
};

export default handler;
