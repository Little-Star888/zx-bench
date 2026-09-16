// ============================================================
// 退役「跨 run 全通过」的推理数学挑战题（2026-09-16）
//
// 用法:
//   node scripts/retire-saturated-challenges.mjs [--dry-run] [--apply-api]
//
// 只改 `status`（benchmark.json 与 DB 的运行时选取依据），
// 题目定义、参考答案、goldSource 与历史 run 行全部保留，可随时回滚。
//
// 依据见 packages/core/src/evaluationLab/challengeRetirement.ts
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';
import {
  RETIRED_REASONING_MATH_CHALLENGE_IDS,
  RETIRED_REASONING_MATH_CHALLENGE_ID_SET,
  CHALLENGE_RETIREMENT_REASON,
} from '../packages/core/dist/evaluationLab/challengeRetirement.js';

const DRY = process.argv.includes('--dry-run');
const APPLY_API = process.argv.includes('--apply-api');
const BASE = process.env.BASE_URL || 'http://localhost:3001';
const RETIRED_AT = '2026-09-16T00:00:00.000Z';

const bankUrl = new URL('../data/scenarios/benchmark.json', import.meta.url);
const metaUrl = new URL('../data/scenarios/benchmark-meta.json', import.meta.url);
const auditUrl = new URL('../data/scenarios/challenge-retirement-2026-09-16.json', import.meta.url);

const bank = JSON.parse(readFileSync(bankUrl, 'utf8'));
const byId = new Map(bank.map(s => [s.id, s]));

const missing = RETIRED_REASONING_MATH_CHALLENGE_IDS.filter(id => !byId.has(id));
if (missing.length) throw new Error(`退役清单中的题号不在 benchmark.json：${missing.join(', ')}`);

const already = [], changed = [];
for (const id of RETIRED_REASONING_MATH_CHALLENGE_IDS) {
  const scenario = byId.get(id);
  if (scenario.dimension !== 'reasoning_math') throw new Error(`${id} 不在 reasoning_math 维度，拒绝退役`);
  if (scenario.status === 'retired') { already.push(id); continue; }
  const before = scenario.status;
  scenario.status = 'retired';
  scenario.scenarioHash = hashScenarioShort(scenario);
  changed.push({ id, from: before, to: 'retired', grader: scenario.grader, difficulty: scenario.difficulty, category: scenario.category });
}

const valid = bank.filter(s => s.status === 'valid');
const retired = bank.filter(s => s.status === 'retired');
const defaultRunCount = valid.filter(s => !s.requirements?.developmentShadow).length;
const meta = JSON.parse(readFileSync(metaUrl, 'utf8'));
const prevValid = meta.validCount;

const audit = {
  date: RETIRED_AT,
  reason: CHALLENGE_RETIREMENT_REASON,
  dimension: 'reasoning_math',
  policy: 'observed-discrimination gate: foundation items (allPass) are capped at maxFoundationRate 20%',
  retired: RETIRED_REASONING_MATH_CHALLENGE_IDS,
  changed,
  alreadyRetired: already,
  bankBefore: { total: bank.length, valid: prevValid, defaultRunCount: meta.defaultRunCount },
  bankAfter: { total: bank.length, valid: valid.length, defaultRunCount },
  note: 'status-only change; definitions, references and historical run rows are untouched',
};

if (!DRY) {
  writeFileSync(bankUrl, `${JSON.stringify(bank, null, 1)}\n`);
  meta.version = '1.35.0';
  meta.count = valid.length;
  meta.validCount = valid.length;
  meta.retiredCount = Number(meta.retiredCount ?? 0) + changed.length;
  meta.totalCount = valid.length + meta.retiredCount;
  meta.defaultRunCount = defaultRunCount;
  meta.dimensions = Object.fromEntries([...new Set(valid.map(s => s.dimension))].sort()
    .map(d => [d, valid.filter(s => s.dimension === d).length]));
  meta.generatedAt = RETIRED_AT;
  writeFileSync(metaUrl, `${JSON.stringify(meta, null, 1)}\n`);
  writeFileSync(auditUrl, `${JSON.stringify(audit, null, 1)}\n`);
}

console.log(JSON.stringify({
  dryRun: DRY, changed: changed.length, alreadyRetired: already.length,
  bank: { total: bank.length, valid: valid.length, retired: retired.length, defaultRunCount },
  meta: { version: meta.version, validCount: meta.validCount, retiredCount: meta.retiredCount, defaultRunCount: meta.defaultRunCount },
  reasoning_mathValid: valid.filter(s => s.dimension === 'reasoning_math').length,
}, null, 2));

if (APPLY_API && !DRY) {
  let ok = 0, fail = 0;
  for (const id of RETIRED_REASONING_MATH_CHALLENGE_IDS) {
    try {
      const res = await fetch(`${BASE}/api/scenarios`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(byId.get(id)),
      });
      const body = await res.json();
      if (body.success) ok++; else { fail++; console.error(`  ✗ ${id}: ${body.error}`); }
    } catch (err) { fail++; console.error(`  ✗ ${id}: ${err.message}`); }
  }
  console.log(`API 同步: ok=${ok} fail=${fail}`);
  if (fail) process.exitCode = 1;
}
