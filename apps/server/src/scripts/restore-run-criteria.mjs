import { PrismaClient } from '@prisma/client';
import { buildConstraintCriteria, resolveConstraints } from '../../../../packages/core/dist/orchestrator.js';

const runId = process.argv[2];
const apply = process.argv.includes('--apply');
if (!runId) throw new Error('Usage: node restore-run-criteria.mjs RUN_ID [--apply]');

const prisma = new PrismaClient();
try {
  const run = await prisma.evalRun.findUnique({ where: { id: runId }, select: { config: true, manifest: true } });
  if (!run?.manifest) throw new Error('Run or frozen manifest not found');
  const config = JSON.parse(run.config);
  const scenarios = new Map(JSON.parse(run.manifest).benchmarkPack.scenarios.map(s => [s.id, s]));
  const rows = await prisma.scenarioResult.findMany({
    where: { evalRunId: runId },
    select: { id: true, scenarioId: true, modelOutput: true, outputMetadata: true, evidence: true },
  });
  const updates = [];
  const mismatches = [];
  let checked = 0;
  for (const row of rows) {
    const scenario = scenarios.get(row.scenarioId);
    if (!scenario) throw new Error(`Missing frozen scenario ${row.scenarioId}`);
    const metadata = JSON.parse(row.outputMetadata);
    const audit = metadata.evaluationAudit;
    if (!audit) continue;
    const generated = buildConstraintCriteria(resolveConstraints(scenario, config.constraints), {
      modelOutput: row.modelOutput,
      outputMetadata: metadata,
    });
    const existing = audit.criterionResults;
    if (Array.isArray(existing) && existing.length) {
      if (existing.every(item => generated.some(candidate => candidate.id === item.id))) {
        checked++;
        if (JSON.stringify(existing) !== JSON.stringify(generated)) mismatches.push(row.scenarioId);
      }
      continue;
    }
    if (!row.evidence.includes('JUDGE_RESCORED:') || !generated.length) continue;
    updates.push({ id: row.id, scenarioId: row.scenarioId, outputMetadata: JSON.stringify({
      ...metadata, evaluationAudit: { ...audit, criterionResults: generated },
    }) });
  }
  console.log(JSON.stringify({ runId, checked, mismatches, pending: updates.length, applied: apply ? updates.length : 0 }));
  if (mismatches.length) throw new Error('Generated criteria differ from preserved originals');
  if (apply) {
    for (const update of updates) {
      await prisma.scenarioResult.update({
        where: { id: update.id },
        data: { outputMetadata: update.outputMetadata },
      });
    }
  }
} finally {
  await prisma.$disconnect();
}
