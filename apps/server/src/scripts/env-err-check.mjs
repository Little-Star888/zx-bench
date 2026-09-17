import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  for (const rid of ['zxbench-pro-2026-09-17T08-50-24-382Z-1060df11', 'zxbench-pro-2026-09-17T09-27-31-482Z-a7940186']) {
    const r = await prisma.evalRun.findUnique({ where: { id: rid } });
    if (!r) continue;
    const cfg = JSON.parse(r.config);
    const mc = await prisma.modelConfig.findUnique({ where: { id: r.modelConfigId } });
    console.log(`${r.name} | ${r.status} | 模型=${mc?.name} @ ${mc?.baseUrl}`);
    console.log(`   config.judgeModelConfigId=${cfg.judgeModelConfigId} | judgeEnabled=${cfg.judgeEnabled}`);
  }
  // 直连官方的 deepseek-v4-flash 候选
  const cands = await prisma.modelConfig.findMany({ where: { name: 'deepseek-v4-flash' } });
  console.log('\n直连 api.deepseek.com 的 deepseek-v4-flash 候选:');
  for (const c of cands) {
    if (c.baseUrl.includes('api.deepseek.com')) {
      console.log(`  ${c.id} | ${c.displayName || c.name} | ${c.baseUrl} | reasoning=${c.reasoningModel}`);
    }
  }
}
main().finally(() => prisma.$disconnect());
