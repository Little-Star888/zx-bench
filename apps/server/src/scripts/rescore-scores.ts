/**
 * 历史数据离线重算脚本（评分契约重构后）
 * 用新评分器对已保存的 modelOutput 重新评分，无需重新调用模型。
 * 沙箱测试（JS/TS patch 验证、编译检查）会在重算时重新执行。
 *
 * 运行:
 *   cd apps/server
 *   npx tsx src/scripts/rescore-scores.ts
 *   # 可选环境变量:
 *   #   RESCORE_LIMIT=100  只重算最近 100 条
 *   #   RESCORE_RUN_ID=... 只重算指定运行
 *   #   RESCORE_DIM=program 只重算指定维度
 *   #   DRY_RUN=1          只预览不写库
 */
import { PrismaClient } from '@prisma/client';
import {
  getEvaluator, registerEvaluator,
  bugFindingEvaluator, codeRepairEvaluator, structuredOutputEvaluator,
  dataExtractionEvaluator, exactAnswerLineEvaluator, instructionChecklistEvaluator,
  canaryAuthorityEvaluator, toolCallTraceEvaluator, agentTraceEvaluator, cliCommandEvaluator,
  projectRepairEvaluator, hallucinationResistanceEvaluator, sandboxEvaluator, llmJudgeEvaluator,
  challengeExtensionEvaluator, challengeSupplementEvaluator,
  ultraBatchPartEvaluator, ultraProofPartEvaluator,
  getJudgeWeights, mixDeterministicJudge, applyReviewedVerdict,
} from '@zxbench/core';
import type { Scenario, Difficulty, QuestionStatus, ScenarioTier, Verdict, OutputPolicy, EvalRunConfig } from '@zxbench/types';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ===== 注册评分器（与 apps/server/src/index.ts 启动逻辑一致） =====
registerEvaluator(bugFindingEvaluator);
registerEvaluator(codeRepairEvaluator);
registerEvaluator(projectRepairEvaluator);
registerEvaluator(structuredOutputEvaluator);
registerEvaluator(dataExtractionEvaluator);
registerEvaluator(exactAnswerLineEvaluator);
registerEvaluator(instructionChecklistEvaluator);
registerEvaluator(canaryAuthorityEvaluator);
registerEvaluator(toolCallTraceEvaluator);
registerEvaluator(agentTraceEvaluator);
registerEvaluator(cliCommandEvaluator);
registerEvaluator(hallucinationResistanceEvaluator);
registerEvaluator(sandboxEvaluator);
registerEvaluator(llmJudgeEvaluator);
registerEvaluator(challengeExtensionEvaluator);
registerEvaluator(challengeSupplementEvaluator);
registerEvaluator(ultraBatchPartEvaluator);
registerEvaluator(ultraProofPartEvaluator);

// ===== 手动加载 apps/server/.env（DATABASE_URL） =====
function loadEnv() {
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

const prisma = new PrismaClient();

// ===== DB 行 → Scenario =====
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserializeScenario(row: any): Scenario {
  return {
    id: row.id,
    dimension: row.dimension,
    category: row.category,
    difficulty: row.difficulty as Difficulty,
    language: row.language,
    locale: row.locale,
    status: row.status as QuestionStatus,
    tier: (row.tier || 'public_dev') as ScenarioTier,
    promptTemplate: row.promptTemplate,
    sourceCode: row.sourceCode ?? undefined,
    functionName: row.functionName ?? undefined,
    expectedVerdict: (row.expectedVerdict ?? undefined) as Verdict | undefined,
    grader: row.grader,
    graderVersion: row.graderVersion,
    scoring: JSON.parse(row.scoring),
    hiddenTests: row.hiddenTests ? JSON.parse(row.hiddenTests) : undefined,
    requirements: row.requirements ? JSON.parse(row.requirements) : undefined,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    scenarioVersion: row.scenarioVersion,
    scenarioHash: row.scenarioHash,
    outputPolicy: (row.outputPolicy ?? undefined) as OutputPolicy | undefined,
    answerFirst: row.answerFirst ?? undefined,
    maxAnswerTokens: row.maxAnswerTokens ?? undefined,
    maxReasoningTokens: row.maxReasoningTokens ?? undefined,
  };
}

async function main() {
  const limit = process.env.RESCORE_LIMIT ? parseInt(process.env.RESCORE_LIMIT, 10) : undefined;
  const dimFilter = process.env.RESCORE_DIM;
  const runIdFilter = process.env.RESCORE_RUN_ID;
  const dryRun = process.env.DRY_RUN === '1';
  // 强制重算已带证据标记的结果（评分器契约升级后需全量刷新）
  const force = process.env.RESCORE_FORCE === '1';

  console.log('=== 历史结果离线重算（新评分契约）===\n');

  // Querying a large SQLite result set with a repeated manifest relation can
  // exceed Prisma's N-API string conversion on Node 26. A run-scoped rescore
  // loads the parent once and attaches only the config needed below.
  let results: any[];
  if (runIdFilter) {
    const run = await prisma.evalRun.findUnique({ where: { id: runIdFilter }, include: { results: true } });
    if (!run) throw new Error(`run not found: ${runIdFilter}`);
    const selected = limit ? run.results.slice(0, limit) : run.results;
    results = selected.map(result => ({ ...result, evalRun: { config: run.config } }));
  } else {
    results = await prisma.scenarioResult.findMany({
      orderBy: { finishedAt: 'desc' },
      take: limit,
      include: { evalRun: true },
    });
  }
  console.log(`待重算 ${results.length} 条${dryRun ? '（DRY-RUN，不写库）' : ''}\n`);

  let updated = 0;
  let skipped = 0;
  let changed = 0;

  for (const r of results) {
    if (dimFilter && r.dimension !== dimFilter) { skipped++; continue; }

    // 已带证据标记的默认跳过（分数与证据均为最新，避免重复沙箱测试耗时）；RESCORE_FORCE=1 时强制重算
    if (r.axisEvidence && !force) { skipped++; continue; }

    const sd = await prisma.scenarioDefinition.findUnique({ where: { id: r.scenarioId } });
    if (!sd) { skipped++; continue; }

    const evaluator = getEvaluator(sd.grader, sd.graderVersion);
    if (!evaluator) {
      console.log(`  [跳过] ${r.scenarioId} 无评分器 ${sd.grader}@${sd.graderVersion}`);
      skipped++;
      continue;
    }

    let outputMetadata;
    try { outputMetadata = JSON.parse(r.outputMetadata); } catch { outputMetadata = {}; }

    try {
      const scenario = deserializeScenario(sd);
      const runConfig = JSON.parse(r.evalRun.config) as EvalRunConfig;
      if (scenario.answerFirst == null && runConfig.constraints?.answerFirst != null) {
        scenario.answerFirst = runConfig.constraints.answerFirst;
      }
      const det = await evaluator.evaluate(scenario, r.modelOutput, outputMetadata);

      const newDet = det.totalScore ?? r.totalScore;
      const weights = getJudgeWeights(scenario.dimension, scenario.grader);
      // judge 合并：覆盖率感知（与 orchestrator 一致）——未测量轴由 judge 补判 / 无 judge 时打折
      const coverage = det.axisCoverage ?? 1;
      const semanticJudgeLed = scenario.dimension === 'hallucination_resistance'
        || scenario.grader === 'cli_command';
      const mixed = mixDeterministicJudge(weights.deterministic, weights.judge, coverage, semanticJudgeLed ? .7 : undefined);
      let finalTotal = (r.judgeScore != null && weights.judge > 0)
        ? Math.round(newDet * mixed.detW + r.judgeScore * mixed.judgeW)
        : (coverage >= 0.5 ? newDet : Math.round(newDet * 0.3));

      const scored = { ...det, totalScore: finalTotal };
      let savedJudge;
      try { savedJudge = r.finalJudge ? JSON.parse(r.finalJudge) : undefined; } catch { savedJudge = undefined; }
      applyReviewedVerdict(scored, savedJudge);
      finalTotal = scored.totalScore ?? finalTotal;

      // 证据标记兜底：未显式标注的轴默认视为 rule（与 orchestrator 行为一致）
      const axisScoresOut = scored.axisScores || {};
      const axisEvidenceOut = {
        ...(scored.axisEvidence || {}),
        ...Object.fromEntries(
          Object.keys(axisScoresOut)
            .filter((k) => !scored.axisEvidence || scored.axisEvidence[k] == null)
            .map((k) => [k, 'rule']),
        ),
      };

      const oldTotal = r.totalScore;
      const diffMark = finalTotal !== oldTotal ? '⚠️' : '·';
      console.log(`  [${diffMark}] ${r.scenarioId}  ${oldTotal} → ${finalTotal} (det=${newDet}${r.judgeScore != null ? `, judge=${r.judgeScore}` : ''})`);

      if (finalTotal !== oldTotal) changed++;

      if (!dryRun) {
        const oldEvidence = r.evidence ? JSON.parse(r.evidence) as string[] : [];
        const preservedEvidence = oldEvidence.filter(item => item.startsWith('SANDBOX_EXECUTED:'));
        await prisma.scenarioResult.update({
          where: { id: r.id },
          data: {
            totalScore: finalTotal,
            deterministicScore: newDet,
            axisScores: JSON.stringify(axisScoresOut),
            axisEvidence: JSON.stringify(axisEvidenceOut),
            evidence: JSON.stringify([...preservedEvidence, ...(scored.evidence || [])]),
            graderVersion: `${evaluator.name}@${evaluator.version}`,
            scoreHistory: r.runCount === 1 ? JSON.stringify([finalTotal]) : r.scoreHistory,
            humanReviewRequired: scored.humanReviewRequired ?? false,
            environmentError: scored.environmentError ?? false,
            formatParseSuccess: scored.formatParseSuccess ?? r.formatParseSuccess,
          },
        });
      }
      updated++;
    } catch (err) {
      console.log(`  [错误] ${r.scenarioId}: ${err instanceof Error ? err.message : String(err)}`);
      skipped++;
    }
  }

  console.log(`\n=== 完成！更新 ${updated} 条，跳过 ${skipped} 条，分数变化 ${changed} 条 ===`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
