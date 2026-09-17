// ============================================================
// UMX-01 就地升级：把 2026-09-17 重写的四问题面同步进题库。
//
//   node scripts/upgrade-umx01-questions.mjs [--apply] [--apply-api]
//
// 背景：UMX-01 原版在 V=F₂⁶ 上要求完整共轭分类 + 中心化子阶分布 + 扩域 F₄ 秩分布，
// 在 tools=false、单问限时 360/1200 秒下不可达（实测 8 问里 7 问恒为 0 分）。
// 新版降到 V=F₂⁴、二维公共空间，四问的 gold 依次为
//   P1: 4096 / 35   P2: 3906   P3: 3780   P4: 162 / 144 / 0（不可能性）
// 全部由两套独立实现枚举复核（tmp/_zx_math/design_umx01b.py 与 verify_umx01.py）。
//
// 只改 promptTemplate / requirements.questionHash / scenarioVersion / scenarioHash，
// 其余字段原样保留；题目 id 不变（UMX-01-P1..P4），历史 run 行不受影响。
// UMX-02 未改动，脚本会显式跳过并报出「题面是否与 markdown 一致」。
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { buildUltraMathQuestions } from '../packages/core/dist/evaluationLab/ultraMathQuestions.js';
import { ULTRA_MATH_RELEASE } from '../packages/core/dist/evaluationLab/ultraMathRubric.js';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const APPLY = process.argv.includes('--apply');
const APPLY_API = process.argv.includes('--apply-api');
const BASE = process.env.BASE_URL || 'http://localhost:3001';
const TARGETS = ['UMX-01-P1', 'UMX-01-P2', 'UMX-01-P3', 'UMX-01-P4'];
const NEXT_VERSION = '1.1.0';

const ROOT = new URL('../', import.meta.url);
const markdown = readFileSync(new URL('docs/ultra-math-2026-09-14-questions.md', ROOT), 'utf8');
const pack = buildUltraMathQuestions(markdown);
const byQ = new Map(pack.questions.map(q => [q.id, q]));

const bankUrl = new URL('data/scenarios/benchmark.json', ROOT);
const bank = JSON.parse(readFileSync(bankUrl, 'utf8'));
const byId = new Map(bank.map(s => [s.id, s]));

// 自检：UMX-02 四问的题面必须与题库一致（本脚本不应改动它们）
const untouched = [];
for (const id of ['UMX-02-P1', 'UMX-02-P2', 'UMX-02-P3', 'UMX-02-P4']) {
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
  meta.version = '1.42.0';
  meta.generatedAt = '2026-09-17T00:00:00.000Z';
  meta.ultraMath = { questionVersion: ULTRA_MATH_RELEASE.questionVersion, rubricVersion: ULTRA_MATH_RELEASE.version,
    note: 'UMX-01 于 2026-09-17 重写为可达版本（V=F₂⁴ + 二维公共空间）；UMX-02 未改动。' };
  writeFileSync(metaUrl, `${JSON.stringify(meta, null, 1)}\n`);
  const auditUrl = new URL('data/scenarios/umx01-rewrite-2026-09-17.json', ROOT);
  writeFileSync(auditUrl, `${JSON.stringify({
    date: '2026-09-17T00:00:00.000Z', dimension: 'reasoning_math', grader: 'ultra_proof_part',
    questionVersion: ULTRA_MATH_RELEASE.questionVersion, rubricVersion: ULTRA_MATH_RELEASE.version,
    reason: '原版 UMX-01 在 V=F₂⁶ 上要求完整共轭分类 + 中心化子阶分布 + 扩域 F₄ 秩分布，'
      + '无工具下不可达：实测 8 问里 7 问恒为 0 分（HARD_TIME_LIMIT 1200s 或 token 耗尽），'
      + '而 ultra_proof_part 的 judge 是唯一评分器，无输出即 0 且计入维度均分。',
    designPrinciple: '难度递增 = 判断难度递增，不是计算量递增；每问最短可算路径必须落在 10²~10³ 次基本运算内。',
    gold: { 'UMX-01-P1': [4096, 35], 'UMX-01-P2': [3906], 'UMX-01-P3': [3780], 'UMX-01-P4': [162, 144, 0] },
    verification: '两套独立实现枚举复核（design_umx01b.py 位编码版 vs verify_umx01.py Fractions+显式列张成版）：'
      + '7 项计数全部一致；闭式另做构造性验证（反例 3·4³−3+1=190；互异直线 3!·3³=162；反例 6·3=18）。',
    screeningArchive: 'v2 的 Qwen 33.0 / DeepSeek 38.5 已标注为历史值（invalidForCurrentQuestions）。',
    changed, alreadyUpgraded: already,
  }, null, 1)}\n`);
  console.log(`\nbenchmark.json 已更新（${changed.length} 行）；审计 -> umx01-rewrite-2026-09-17.json`);
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
