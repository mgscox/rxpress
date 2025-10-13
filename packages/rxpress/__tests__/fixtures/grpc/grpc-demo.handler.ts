import type { GrpcLocalHandler } from '../../../src/types/grpc.types.js';

let counter = 0;

export const handler: GrpcLocalHandler = {
  name: 'grpc-demo-handler',
  async invoke(method, input, meta, ctx) {
    counter += 1;
    ctx.log('info', 'grpc-demo handler invoked', { method, counter });

    const runId = ctx.run?.id ?? 'no-run';
    const current = (await ctx.kv.get<number>('demo:count')) ?? 0;
    await ctx.kv.set('demo:count', current + 1);

    if (method === 'api') {
      if (ctx.run) {
        await ctx.run.set('stage', 'route');
      }

      await ctx.emit({
        topic: 'grpc::stage',
        data: {
          step: 'route',
          body: input?.body,
          runId,
        },
        run: ctx.run,
      });

      return {
        status: 201,
        headers: {
          'x-run-id': runId,
        },
        body: {
          ok: true,
          runId,
          echo: input?.body,
          meta,
        },
      };
    }

    if (method === 'event') {
      const stage = ctx.run ? await ctx.run.get<string>('stage') : undefined;

      if (ctx.run) {
        await ctx.run.set('stage', `${stage ?? 'unknown'}->event`);
      }

      await ctx.emit({
        topic: 'grpc::final',
        data: {
          step: 'event',
          stage: ctx.run ? await ctx.run.get<string>('stage') : stage,
          runId,
        },
        run: ctx.run,
      });

      return {};
    }

    return {
      status: 200,
      body: {
        ok: true,
        method,
      },
    };
  },
};

export default handler;
