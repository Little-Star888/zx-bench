// ============================================================
// 给 UMX 八题补标注：它们**不可用普通 run 路径评分**，因此退出默认题库。
//
//   node scripts/mark-umx-not-atomically-scoreable.mjs [--apply] [--apply-api]
//
// 依据（2026-09-17 核查）：
//   1. `ultra_proof_part`（UMX 用的评分器）恒返回 `totalScore: 0` + `evidence: ['PROOF_REQUIRES_RUBRIC_JUDGE']`
//      —— 它把判分完全交给 rubric judge（见 evaluators/ultraBatchPart.ts）。
//   2. 但 `scoreUltraMathRubric`（evaluationLab/ultraMathRubric.ts）**全仓只被测试引用**，
//      没有任何执行路径；`ULTRA_MATH_RUBRICS` 的 criteria 运行期也从不被消费。
//   3. ⇒ 走普通 run 时会落到**通用 LLM judge**（判分轴是 judge_bug_detection / judge_root_cause / …，
//      与 UMX 的 criteria 无关）⇒ **谁产出文本谁就 ~100 分**；无输出则恒 0。两种分数都不携带信息。
//
// 采取的措施（不改题面、不改评分器）：
//   · `requirements.developmentShadow = true`  → 退出 defaultRunCount，但**仍可被显式指定运行**
//   · `requirements.scoringPath = 'explicit_progressive_exam'` → 与 manifest 的声明对齐
//   · tags 增加 `rubric_judge_required` / `not_scoreable_by_atomic_runner`
//   · meta.ultraMath 记录原因；audit 文件留痕
//
// 这与 docs/ultra-math-exam-manifest.json 里本来就声明的 `defaultAtomicBank: false` 一致
// —— 之前是题库没落实这个声明。
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const APPLY = process.argv.includes('--apply');
const APPLY_API = process.argv.includes('--apply-api');
const BASE = process.env.BASE_URL || 'http://localhost:3001';

const IDS = ['UMX-01-P1', 'UMX-01-P2', 'UMX-01-P3', 'UMX-01-P4',
             'UMX-02-P1', 'UMX-02-P2', 'UMX-02-P3', 'UMX-02-P4'];
const NEW_TAGS = ['rubric_judge_required', 'not_scoreable_by_atomic_runner'];
const SCORING_PATH = 'explicit_progressive_exam';
const REASON = 'ultra_proof_part 恒返回 0 分 + PROOF_REQUIRES_RUBRIC_JUDGE，'
  + '而 rubric 判分函数（scoreUltraMathRubric）没有接进任何执行路径，'
  + '所以普通 run 会落到通用 LLM judge 上，任何非空答案都拿 ~100 —— 分数不携带信息。';

const ROOT = new URL('../', import.meta.url);
const bankUrl = new URL('data/scenarios/benchmark.json', ROOT);
const metaUrl = new URL('data/scenarios/benchmark-meta.json', ROOT);
const auditUrl = new URL('data/scenarios/umx-restrict-to-exam-track-2026-09-17.json', ROOT);

const bank = JSON.parse(readFileSync(bankUrl, 'utf8'));
const byId = new Map(bank.map(s => [s.id, s]));

const changed = [], already = [], missing = [];
for (const id of IDS) {
  const s = byId.get(id);
  if (!s) { missing.push(id); continue; }
  if (s.grader !== 'ultra_proof_part') throw new Error(`${id} 不是 ultra_proof_part，拒绝标注`);
  const tags = [...(s.tags ?? [])];
  const hasAll = NEW_TAGS.every(t => tags.includes(t));
  if (s.requirements?.developmentShadow === true && s.requirements?.scoringPath === SCORING_PATH && hasAll) {
    already.push(id); continue;
  }
  const before = { shadow: s.requirements?.developmentShadow ?? false, tags: tags.length };
  for (const t of NEW_TAGS) if (!tags.includes(t)) tags.push(t);
  s.requirements = { ...s.requirements, developmentShadow: true, scoringPath: SCORING_PATH };
  s.tags = tags;
  s.scenarioHash = hashScenarioShort(s);
  changed.push({ id, before, tagsAfter: s.tags });
}

const valid = bank.filter(s => s.status === 'valid');
const defaultRunCount = valid.filter(s => !s.requirements?.developmentShadow).length;

console.log(JSON.stringify({
  dryRun: !APPLY, changedCount: changed.length, alreadyMarked: already, missing,
  defaultRunCount, validTotal: valid.length,
  note: 'UMX 仍在 valid 里（定义保留），但不再计入 defaultRunCount；显式指定 scenarioIds 仍可运行',
}, null, 1));
for (const c of changed) console.log(`  ${c.id}  shadow ${c.before.shadow} -> true   tags +${c.tagsAfter.length - c.before.tags}`);
if (missing.length) { console.error('不在题库:', missing); process.exitCode = 1; }

if (APPLY) {
  writeFileSync(bankUrl, `${JSON.stringify(bank, null, 1)}\n`);
  const meta = JSON.parse(readFileSync(metaUrl, 'utf8'));
  meta.version = '1.43.0';
  meta.defaultRunCount = defaultRunCount;
  meta.generatedAt = '2026-09-17T00:00:00.000Z';
  meta.ultraMath = {
    ...(meta.ultraMath ?? {}),
    scoringPath: SCORING_PATH,
    atomicRunDisabled: true,
    atomicRunDisabledReason: REASON,
    note: 'UMX 八题标 developmentShadow 退出默认题库；定义与 rubric 保留，人工/专用轨道仍可用。',
  };
  writeFileSync(metaUrl, `${JSON.stringify(meta, null, 1)}\n`);
  writeFileSync(auditUrl, `${JSON.stringify({
    date: '2026-09-17T00:00:00.000Z', dimension: 'reasoning_math', grader: 'ultra_proof_part',
    reason: REASON,
    evidence: {
      evaluator: 'packages/core/src/evaluators/ultraBatchPart.ts:65 ultraProofPartEvaluator 恒返回 totalScore 0 + PROOF_REQUIRES_RUBRIC_JUDGE',
      noExecutionPath: 'scoreUltraMathRubric 全仓只被 *.test.ts 引用；ULTRA_MATH_RUBRICS 的 criteria 运行期从不被消费',
      observed: '探针 UMX-01-P1/P2 改写后 total=100 det=0 judge=100，但 axisScores={} 且 axisEvidence 里是 judge_bug_detection 等通用轴',
    },
    measure: { developmentShadow: true, scoringPath: SCORING_PATH, tags: NEW_TAGS },
    kept: '题面（v3 改写）、rubric criteria、清单与历史 run 行全部保留',
    changed: changed.map(c => c.id), alreadyMarked: already,
  }, null, 1)}\n`);
  console.log(`\nbenchmark.json 已更新（${changed.length} 行）；defaultRunCount -> ${defaultRunCount}`);
}

if (APPLY_API) {
  if (!APPLY) throw new Error('--apply-api 需要同时给 --apply');
  let ok = 0, fail = 0;
  for (const id of IDS) {
    try {
      const res = await fetch(`${BASE}/api/scenarios`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(byId.get(id)), signal: AbortSignal.timeout(30000) });
      const body = await res.json();
      if (body.success) { ok++; } else { fail++; console.error(`  ✗ ${id}: ${body.error}`); }
    } catch (err) { fail++; console.error(`  ✗ ${id}: ${err.message}`); }
  }
  console.log(`API 同步: ok=${ok} fail=${fail}`);
  if (fail) process.exitCode = 1;
}
