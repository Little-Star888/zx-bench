import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';

/** Explicit IDs only: a displayed group must never silently expand its deletion scope. */
export function registerRunDeletion(
  app: FastifyInstance,
  prisma: PrismaClient,
  isBusy: (id: string) => boolean,
  clearCache: (id: string) => void,
): void {
  let deleting = false;
  const mutations = new Set<FastifyRequest>();
  // Cover resume/retry/report writes and the launch phase of background Judge jobs.
  // The short deletion transaction cannot race a request that already read a run.
  app.addHook('preHandler', async (request, reply) => {
    const route = request.routeOptions.url ?? '';
    if (route === '/api/runs/delete' || !['POST', 'PATCH', 'PUT'].includes(request.method)) return;
    if (!route.startsWith('/api/runs') && route !== '/api/judge-rescore') return;
    if (deleting) return reply.code(409).send({ success: false, error: '正在删除历史记录，请稍后重试' });
    mutations.add(request);
  });
  app.addHook('onResponse', async request => { mutations.delete(request); });

  app.post('/api/runs/delete', async (request, reply) => {
    const body = request.body as { ids?: unknown } | null;
    if (!Array.isArray(body?.ids) || body.ids.length === 0 || body.ids.length > 500 ||
        body.ids.some(id => typeof id !== 'string' || !id.trim())) {
      return reply.code(400).send({ success: false, error: '请提供 1–500 个明确的运行 ID' });
    }
    const ids = [...new Set(body.ids as string[])];
    if (deleting || mutations.size > 0 || ids.some(isBusy)) {
      return reply.code(409).send({ success: false, error: '评测或补评请求尚未结束，请停止任务并等待后台退出后再删除' });
    }
    deleting = true;
    try {
      const outcome = await prisma.$transaction(async tx => {
        const runs = await tx.evalRun.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
        if (runs.length !== ids.length) return 'missing';
        if (runs.some(run => ['running', 'pending'].includes(run.status) || isBusy(run.id))) return 'busy';
        // Keep descendants not explicitly selected, without dangling parent references.
        await tx.evalRun.updateMany({ where: { parentRunId: { in: ids } }, data: { parentRunId: null } });
        await tx.scenarioResult.deleteMany({ where: { evalRunId: { in: ids } } });
        await tx.evalRun.deleteMany({ where: { id: { in: ids } } });
        return 'deleted';
      });
      if (outcome === 'missing') return reply.code(404).send({ success: false, error: '部分记录已不存在，请刷新后重试；本次未删除任何记录' });
      if (outcome === 'busy') return reply.code(409).send({ success: false, error: '所选记录包含运行中或等待中的任务，请先停止任务' });
      ids.forEach(id => clearCache(id));
      return { success: true, data: { deletedIds: ids } };
    } finally {
      deleting = false;
    }
  });
}
