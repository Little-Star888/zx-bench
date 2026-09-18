// ============================================================
// DX3/HX3 题组的**就地上限升级**：把 P1/P2 的时限盒从 180/360 抬到 300/600
//
// 依据（2026-09-18 核查报告 reports/zxbench-review-2026-09-18-5dim.md，F3）：
//   09-17 的 5 维 run 里，48 道 DX3/HX3 的 P1/P2 有 2 题（DX3-03-P1、DX3-04-P1）
//   在 **180 秒**被硬止损（0 分、进工程失败隔离）。这与「不要在时间预算上做文章」
//   是同一类错误：题目作者控制不了模型思考多久，盒子设紧只会制造不可复现的失败。
//   项目参考时限是题级默认 600s / 上限 1200s；此处对齐同仓库数学题包的前两档 300/600。
//
// 改动源头是一个数组：packages/core/src/evaluationLab/evidenceExam/index.ts 的
//   policy.hardSeconds：[180,360,1200,1200] → [300,600,1200,1200]
// 题面文字（「时限N秒」）、每题 questionHash、纸面 contractHash 都由它派生，
// 所以必须用本脚本把题库/DB 重新播种，否则 ultraBatchPart 的一致性守卫会 fail-closed
// 报 STALE_GRADER_PAPER（判 environmentError，不计分）。
//
// 用法:
//   node scripts/upgrade-evidence-exam-parts.mjs                 # dry-run（默认）
//   node scripts/upgrade-evidence-exam-parts.mjs --apply         # 写 benchmark.json + meta + 审计
// 之后（DB 落地，两步，都是既有规范脚本）:
//   node scripts/sync-reviewed-question-contracts.mjs apps/data/zxbench.db --apply
//   node scripts/refresh-stale-tags.mjs --apply --apply-db --db apps/data/zxbench.db
//
// 设计要点
//  1. 白名单 = 纸面里的全部 DX3-*/HX3-* 小问，其余原样跳过 ⇒ 幂等、可重复执行。
//  2. 闸门 1（基线）：题库当前 hardSeconds 必须等于旧盒子的对应档，题面必须印着旧秒数
//     —— 防止在已经改过的题库上再跑一次把别的字段搅乱。
//  3. 闸门 2（目标）：纸面新档位正确、题面印的秒数 == requirements.hardSeconds、分值合计相符。
//  4. 只改 promptTemplate / requirements(points,hardSeconds,questionHash) / tags / scenarioVersion /
//     scenarioHash，题目 id 不变，历史 run 行不受影响。
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { buildEvidenceExam } from '../packages/core/dist/evaluationLab/evidenceExam/index.js';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const APPLY = process.argv.includes('--apply');
const ROOT = new URL('..', import.meta.url);
const bankUrl = new URL('data/scenarios/benchmark.json', ROOT);
const metaUrl = new URL('data/scenarios/benchmark-meta.json', ROOT);
const manifestUrl = new URL('data/scenarios/ultra-batch-release-manifest.json', ROOT);
const auditUrl = new URL('data/scenarios/evidence-exam-timebox-2026-09-18.json', ROOT);
const reportUrl = new URL('tmp/_zx_math/upgrade_evidence_parts_report.json', ROOT);

const PREVIOUS_HARD_SECONDS = [180, 360, 1200, 1200];
const NEW_HARD_SECONDS = [300, 600, 1200, 1200];
const NEXT_VERSION = '1.1.0';
const PREVIOUS_VERSIONS = ['1.0.0'];
const META_VERSION = '1.47.0';
const DATE = '2026-09-18T00:00:00.000Z';

const bank = JSON.parse(readFileSync(bankUrl, 'utf8'));
const meta = JSON.parse(readFileSync(metaUrl, 'utf8'));
const byId = new Map(bank.map(s => [s.id, s]));
const paper = buildEvidenceExam();

const out = {
  dryRun: !APPLY, date: DATE,
  paperVersion: paper.policy.version,
  hardSeconds: { from: PREVIOUS_HARD_SECONDS, to: NEW_HARD_SECONDS },
  paperParts: paper.parts.length,
  changedCount: 0, alreadyUpgraded: [], refused: [], notInBank: [], gates: {},
  changed: [],
};

// ---- 闸门 2：目标纸面自洽 ----
const targetGates = [];
for (const part of paper.parts) {
  const i = part.number - 1;
  if (part.hardSeconds !== NEW_HARD_SECONDS[i]) throw new Error(`${part.id} 纸面 hardSeconds=${part.hardSeconds}，期望 ${NEW_HARD_SECONDS[i]}`);
  const prompt = part.question.messages[0].content;
  if (!prompt.includes(`时限${NEW_HARD_SECONDS[i]}秒`)) throw new Error(`${part.id} 题面未印新时限`);
  if (part.points !== part.items.reduce((s, x) => s + x.points, 0)) throw new Error(`${part.id} 分值合计不符`);
  for (const item of part.items) if (!prompt.includes(item.key)) throw new Error(`${part.id} 题面缺少评分项 ${item.key}`);
  targetGates.push(part.id);
}
out.gates.targetPaperConsistent = targetGates.length === paper.parts.length;

// ---- 逐题升级 ----
for (const part of paper.parts) {
  const scenario = byId.get(part.id);
  if (!scenario) { out.notInBank.push(part.id); continue; }
  if (scenario.dimension !== part.dimension || scenario.grader !== 'ultra_batch_part') {
    throw new Error(`${part.id} 不是 ${part.dimension}/ultra_batch_part，拒绝改写`);
  }
  const prompt = part.question.messages[0].content;
  const req = scenario.requirements ?? {};
  if (scenario.promptTemplate === prompt
      && req.questionHash === part.question.questionHash
      && req.hardSeconds === part.hardSeconds
      && scenario.scenarioVersion === NEXT_VERSION) {
    out.alreadyUpgraded.push(part.id);
    continue;
  }
  // 闸门 1：基线必须是「旧盒子」
  const i = part.number - 1;
  if (req.hardSeconds !== PREVIOUS_HARD_SECONDS[i] || !String(scenario.promptTemplate).includes(`时限${PREVIOUS_HARD_SECONDS[i]}秒`)) {
    out.refused.push({ id: part.id, hardSeconds: req.hardSeconds, expectedBaseline: PREVIOUS_HARD_SECONDS[i] });
    continue;
  }
  if (!PREVIOUS_VERSIONS.includes(scenario.scenarioVersion)) {
    out.refused.push({ id: part.id, scenarioVersion: scenario.scenarioVersion });
    continue;
  }

  const before = { prompt: scenario.promptTemplate, hardSeconds: req.hardSeconds, version: scenario.scenarioVersion };
  scenario.promptTemplate = prompt;
  scenario.requirements = { ...req, points: part.points, hardSeconds: part.hardSeconds, questionHash: part.question.questionHash };
  const tags = (scenario.tags ?? []).filter(t => !/^timeout_\d+s$/.test(t) && !/^points_\d+$/.test(t));
  tags.push(`points_${part.points}`, `timeout_${part.hardSeconds}s`);
  scenario.tags = tags;
  scenario.scenarioVersion = NEXT_VERSION;
  scenario.scenarioHash = hashScenarioShort(scenario);
  out.changed.push({
    id: part.id, groupId: part.groupId, dimension: part.dimension, number: part.number,
    hardSeconds: `${before.hardSeconds} -> ${part.hardSeconds}`,
    version: `${before.version} -> ${NEXT_VERSION}`,
    questionHash: part.question.questionHash.slice(0, 16),
    task: (prompt.match(/本问[：:]([^\n]*)/) ?? [])[1] ?? null,
  });
}
out.changedCount = out.changed.length;
out.gates.noRefused = out.refused.length === 0;
out.gates.noMissing = out.notInBank.length === 0;
out.gates.changedOrAlready = out.changed.length + out.alreadyUpgraded.length === paper.parts.length;
// 每问改后的时限必须恰好等于目标档位（P1 300 / P2 600 / P3~P4 1200）
out.gates.hardSecondsMatchTarget = out.changed.every(c => {
  const after = Number(c.hardSeconds.split(' -> ')[1]);
  return after === NEW_HARD_SECONDS[c.number - 1];
});
// P1/P2 必须比旧盒子更宽（这是本次修订的目的）
out.gates.p1p2Widened = out.changed
  .filter(c => c.number <= 2)
  .every(c => {
    const [before, after] = c.hardSeconds.split(' -> ').map(Number);
    return after > before;
  });
out.pass = Object.values(out.gates).every(Boolean) && !out.refused.length;

writeFileSync(reportUrl, `${JSON.stringify(out, null, 1)}\n`, 'utf8');

if (out.pass && APPLY && out.changedCount > 0) {
  writeFileSync(bankUrl, `${JSON.stringify(bank, null, 1)}\n`, 'utf8');
  meta.version = META_VERSION;
  meta.generatedAt = DATE;
  writeFileSync(metaUrl, `${JSON.stringify(meta, null, 1)}\n`, 'utf8');

  // 发布清单：只加一条 revisions 记录，不改写历史发布事实
  const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
  manifest.revisions = [
    ...(manifest.revisions ?? []).filter(r => r.date !== DATE).filter(Boolean),
    {
      date: DATE,
      scope: 'DX3-*/HX3-* 的 P1/P2 时限盒',
      change: `hardSeconds ${JSON.stringify(PREVIOUS_HARD_SECONDS)} -> ${JSON.stringify(NEW_HARD_SECONDS)}`,
      reason: '2/48 小问在 180 秒盒子里被硬止损（DX3-03-P1、DX3-04-P1）；对齐数学题包前两档 300/600',
      effect: 'P1/P2 的历史分数与本次之后不可直接比较；P3/P4 不变',
      engineVersion: paper.policy.version,
      audit: 'data/scenarios/evidence-exam-timebox-2026-09-18.json',
    },
  ];
  writeFileSync(manifestUrl, `${JSON.stringify(manifest, null, 1)}\n`, 'utf8');

  writeFileSync(auditUrl, `${JSON.stringify({
    date: DATE,
    dimension: ['data_extraction', 'hallucination_resistance'],
    grader: 'ultra_batch_part',
    reason: out.reason ?? 'F3：DX3/HX3 的 P1/P2 时限盒过紧，实测 2 题在 180s 被硬止损',
    engineChange: 'packages/core/src/evaluationLab/evidenceExam/index.ts 的 policy.hardSeconds 与 policy.version',
    fromHardSeconds: PREVIOUS_HARD_SECONDS,
    toHardSeconds: NEW_HARD_SECONDS,
    paperVersion: paper.policy.version,
    contractHash: paper.contractHash,
    questionHashPolicy: 'questionHash = snapshotHash(question)，题面含时限文字 ⇒ 改动必须重播种，否则 ultraBatchPart 报 STALE_GRADER_PAPER',
    fromScenarioVersion: PREVIOUS_VERSIONS,
    toScenarioVersion: NEXT_VERSION,
    changed: out.changed,
    applyDb: [
      'node scripts/sync-reviewed-question-contracts.mjs apps/data/zxbench.db --apply',
      'node scripts/refresh-stale-tags.mjs --apply --apply-db --db apps/data/zxbench.db',
    ],
  }, null, 1)}\n`, 'utf8');
  out.wrote = { bank: true, meta: META_VERSION, manifestRevision: true, audit: 'evidence-exam-timebox-2026-09-18.json' };
  writeFileSync(reportUrl, `${JSON.stringify(out, null, 1)}\n`, 'utf8');
}

if (!out.pass) process.exitCode = 1;
