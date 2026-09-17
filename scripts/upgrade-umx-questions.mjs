// ============================================================
// UMX 题组的**就地升级**：把重写后的题面同步进题库（覆盖 UMX-01 与 UMX-02）。
//
//   node scripts/upgrade-umx-questions.mjs [--apply] [--apply-api]
//
// 历次内容
//   v3（2026-09-17）：UMX-01 由 V=F₂⁶ 的完整共轭分类改写为 V=F₂⁴、二维公共空间的可达版本。
//   v4（2026-09-17）：UMX-02 由「3×3 矩阵三元组 + ∀本原 λ 秩条件」改写为
//        f(x)=x²(x−1) ≡ 0 (mod 2^k) 的奇异同余（主题不变：模 2^k / 奇异分支 / 逐层提升）。
//        改写的量化依据见 data/scenarios/umx02-rewrite-2026-09-17.json。
//
// 只改 promptTemplate / requirements.questionHash / scenarioVersion / scenarioHash，
// 其余字段原样保留；题目 id 不变（UMX-01/02-P1..P4），历史 run 行不受影响。
// 脚本内置自检：**另一组**的题面必须已与 markdown 一致（不应被本轮改动）。
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { buildUltraMathQuestions } from '../packages/core/dist/evaluationLab/ultraMathQuestions.js';
import { ULTRA_MATH_RELEASE } from '../packages/core/dist/evaluationLab/ultraMathRubric.js';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const APPLY = process.argv.includes('--apply');
const APPLY_API = process.argv.includes('--apply-api');
const BASE = process.env.BASE_URL || 'http://localhost:3001';
const TARGETS = ['UMX-02-P1', 'UMX-02-P2', 'UMX-02-P3', 'UMX-02-P4'];
const NEXT_VERSION = '1.1.0';

const ROOT = new URL('../', import.meta.url);
const markdown = readFileSync(new URL('docs/ultra-math-2026-09-14-questions.md', ROOT), 'utf8');
const pack = buildUltraMathQuestions(markdown);
const byQ = new Map(pack.questions.map(q => [q.id, q]));

const bankUrl = new URL('data/scenarios/benchmark.json', ROOT);
const bank = JSON.parse(readFileSync(bankUrl, 'utf8'));
const byId = new Map(bank.map(s => [s.id, s]));

// 自检：UMX-01 四问的题面必须**已经**与题库一致（上一轮升过，本轮不应再变）
const untouched = [];
for (const id of ['UMX-01-P1', 'UMX-01-P2', 'UMX-01-P3', 'UMX-01-P4']) {
  const s = byId.get(id), q = byQ.get(id);
  if (!s || !q) { untouched.push(`${id}: 缺`); continue; }
  const same = s.promptTemplate === q.messages[0].content;
  untouched.push(`${id}: 题面与 markdown ${same ? '一致 ✓' : '不一致 ✗'}`);
}

const changed = [], already = [], missing = [];
for (const id of TARGETS) {
  const scenario = byId.get(id), q = byQ.get(id);
  if (!scenario || !q) { missing.push(id); continue; }
  if (scenario.grader !== 'ultra_proof_part') throw new Error(`${id} 不是 ultra_proof_part，拒绝改写`);
  const prompt = q.messages[0].content;
  if (scenario.promptTemplate === prompt && scenario.requirements?.questionHash === q.questionHash) {
    already.push(id); continue;
  }
  if (scenario.scenarioVersion !== '1.0.0') throw new Error(`${id} 的 scenarioVersion=${scenario.scenarioVersion}，非预期基线 1.0.0`);
  const before = { version: scenario.scenarioVersion, len: String(scenario.promptTemplate).length, hash: scenario.requirements?.questionHash };
  scenario.promptTemplate = prompt;
  scenario.requirements = { ...scenario.requirements, questionHash: q.questionHash };
  scenario.scenarioVersion = NEXT_VERSION;
  scenario.scenarioHash = hashScenarioShort(scenario);
  changed.push({ id, version: `${before.version} -> ${NEXT_VERSION}`, promptLen: `${before.len} -> ${prompt.length}`,
    hash: `${String(before.hash).slice(0, 12)} -> ${q.questionHash.slice(0, 12)}`,
    firstTask: (prompt.match(/本问：\s*\n?([^\n]*)/) ?? [])[1]?.slice(0, 70) ?? '' });
}

console.log(JSON.stringify({
  dryRun: !APPLY, questionVersion: ULTRA_MATH_RELEASE.questionVersion, rubricVersion: ULTRA_MATH_RELEASE.version,
  changedCount: changed.length, alreadyUpgraded: already, missing,
  umx02UntouchedSelfCheck: untouched,
}, null, 1));
for (const c of changed) console.log(`  ${c.id}  ${c.version}  prompt ${c.promptLen}  hash ${c.hash}\n     本问: ${c.firstTask}`);
if (missing.length) { console.error('不在题库:', missing); process.exitCode = 1; }

if (APPLY) {
  writeFileSync(bankUrl, `${JSON.stringify(bank, null, 1)}\n`);
  const metaUrl = new URL('data/scenarios/benchmark-meta.json', ROOT);
  const meta = JSON.parse(readFileSync(metaUrl, 'utf8'));
  meta.version = '1.44.0';
  meta.generatedAt = '2026-09-17T00:00:00.000Z';
  meta.ultraMath = { questionVersion: ULTRA_MATH_RELEASE.questionVersion, rubricVersion: ULTRA_MATH_RELEASE.version,
    note: 'UMX-01（v3）与 UMX-02（v4）均已重写为可达版本；UMX 八题标 developmentShadow，只在人工/专用轨道使用。' };
  writeFileSync(metaUrl, `${JSON.stringify(meta, null, 1)}\n`);
  const auditUrl = new URL('data/scenarios/umx02-rewrite-2026-09-17.json', ROOT);
  writeFileSync(auditUrl, `${JSON.stringify({
    date: '2026-09-17T00:00:00.000Z', dimension: 'reasoning_math', grader: 'ultra_proof_part',
    questionVersion: ULTRA_MATH_RELEASE.questionVersion, rubricVersion: ULTRA_MATH_RELEASE.version,
    reason: '原版 UMX-02 要求 3×3 矩阵三元组中**每个本原 λ** 的线性组合都左右等价于 diag(1,1,0)。'
      + '该条件是为 3×3 调的：降到 2×2 后枚举可证最多满足 24/56 个本原 λ（加入任一混合方向即归零），'
      + '而保留 3×3 则候选空间 512³≈1.34 亿、且 Z/2^k 上左右等价缺少可靠判据'
      + '（Fitting 理想不能决定等价类：diag(2,0) 与 diag(2,2) 理想相同却不同类）。',
    designPrinciple: '换载体而保主题：保留 模 2^k / 奇异分支 / 逐层提升，把载体换成标量同余；'
      + '四问动作与原版一一对应（计数 → 解集结构 → 提升充要条件 → 任意层级闭式与无限提升）。',
    gold: { 'UMX-02-P1': [3, [0, 1, 4]], 'UMX-02-P2': [5, '2^50+1'], 'UMX-02-P3': [1, 2, 32], 'UMX-02-P4': [512, '2^49'] },
    verification: '双路：暴力枚举（k≤16，逐点代入 f）vs 结构式（S_k = {x : v₂(x) ≥ ⌈k/2⌉} ∪ {1}）；'
      + 'N(k)=2^⌊k/2⌋+1 两路完全一致；提升结构（不可提升个数 = 0/2^(k/2−1)）实测与推导 k=1..11 全对；'
      + '无限提升支经连续 5 层实测确认。见 tmp/_zx_math/gold_umx02.py',
    changed, alreadyUpgraded: already,
  }, null, 1)}\n`);
  console.log(`\nbenchmark.json 已更新（${changed.length} 行）；审计 -> umx02-rewrite-2026-09-17.json`);
}

if (APPLY_API) {
  if (!APPLY) throw new Error('--apply-api 需要同时给 --apply');
  let ok = 0, fail = 0;
  for (const c of changed) {
    try {
      const res = await fetch(`${BASE}/api/scenarios`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(byId.get(c.id)), signal: AbortSignal.timeout(30000) });
      const body = await res.json();
      if (body.success) { ok++; console.log(`  synced ${c.id}`); }
      else { fail++; console.error(`  ✗ ${c.id}: ${body.error}`); }
    } catch (err) { fail++; console.error(`  ✗ ${c.id}: ${err.message}`); }
  }
  console.log(`API 同步: ok=${ok} fail=${fail}`);
  if (fail) process.exitCode = 1;
}
