// ============================================================
// 退役「对 27B 本地模型已饱和」的 MX3 高难度题组（2026-09-17）
//
// 用法:
//   node scripts/retire-saturated-exam-groups.mjs [--dry-run] [--apply-api]
//
// 只改 `status`（benchmark.json 与 DB 的运行时选取依据），
// 题包定义、参考答案、goldSource 与历史 run 行全部保留，可随时回滚。
//
// 依据见 packages/core/src/evaluationLab/ultraGroupRetirement.ts
// ⚠️ 判据是「连 27B 都每次都满分」（用户指定），**不是**官方门禁的
//    「跨模型无区分」——两者不等价，详见该模块的注释。
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';
import {
  RETIRED_EXAM_GROUP_IDS,
  EXAM_GROUP_RETIREMENT_REASON,
  EXAM_GROUP_RETIREMENT_SCOPE,
} from '../packages/core/dist/evaluationLab/ultraGroupRetirement.js';

const DRY = process.argv.includes('--dry-run');
const APPLY_API = process.argv.includes('--apply-api');
const BASE = process.env.BASE_URL || 'http://localhost:3001';
const RETIRED_AT = '2026-09-17T00:00:00.000Z';

const bankUrl = new URL('../data/scenarios/benchmark.json', import.meta.url);
const metaUrl = new URL('../data/scenarios/benchmark-meta.json', import.meta.url);
const auditUrl = new URL('../data/scenarios/exam-group-retirement-2026-09-17.json', import.meta.url);

const bank = JSON.parse(readFileSync(bankUrl, 'utf8'));
const byId = new Map(bank.map(s => [s.id, s]));

const missing = RETIRED_EXAM_GROUP_IDS.filter(id => !byId.has(id));
if (missing.length) throw new Error(`退役清单中的题号不在 benchmark.json：${missing.join(', ')}`);

const already = [], changed = [];
for (const id of RETIRED_EXAM_GROUP_IDS) {
  const scenario = byId.get(id);
  if (scenario.dimension !== 'reasoning_math') throw new Error(`${id} 不在 reasoning_math 维度，拒绝退役`);
  if (scenario.grader !== 'ultra_batch_part') throw new Error(`${id} 不是 ultra_batch_part，拒绝退役`);
  if (scenario.status === 'retired') { already.push(id); continue; }
  const before = scenario.status;
  scenario.status = 'retired';
  scenario.scenarioHash = hashScenarioShort(scenario);
  changed.push({ id, from: before, to: 'retired', groupId: scenario.requirements?.groupId,
    partNumber: scenario.requirements?.partNumber, points: scenario.requirements?.points });
}

const valid = bank.filter(s => s.status === 'valid');
const retired = bank.filter(s => s.status === 'retired');
const defaultRunCount = valid.filter(s => !s.requirements?.developmentShadow).length;

// 自检：MX3-24 必须**不被**退役（它是唯一有区分信号的一组）
if (RETIRED_EXAM_GROUP_IDS.some(id => id.startsWith('MX3-24'))) throw new Error('MX3-24 不应在退役清单里');

const audit = {
  date: RETIRED_AT,
  reason: EXAM_GROUP_RETIREMENT_REASON,
  scope: EXAM_GROUP_RETIREMENT_SCOPE,
  dimension: 'reasoning_math',
  criterion: 'user-specified: the local 27B model scored 100 on every run of these parts',
  notTheCriterion: 'official observed-discrimination gate (cross-model separation) — these are not equivalent; '
    + 'e.g. RM-CN saturates the 27B model yet the gate measures allPassItems=0 / separatingRate=94.1%',
  retired: RETIRED_EXAM_GROUP_IDS,
  changed,
  alreadyRetired: already,
  bankAfter: { total: bank.length, valid: valid.length, retired: retired.length, defaultRunCount },
  note: 'status-only change; the exam pack still defines these groups, references and historical run rows are untouched',
};

if (!DRY) {
  writeFileSync(bankUrl, `${JSON.stringify(bank, null, 1)}\n`);
  const meta = JSON.parse(readFileSync(metaUrl, 'utf8'));
  meta.version = '1.39.0';
  meta.count = valid.length;
  meta.validCount = valid.length;
  meta.retiredCount = Number(meta.retiredCount ?? 0) + changed.length;
  meta.totalCount = valid.length + meta.retiredCount;
  meta.defaultRunCount = defaultRunCount;
  meta.dimensions = Object.fromEntries([...new Set(valid.map(s => s.dimension))].sort()
    .map(d => [d, valid.filter(s => s.dimension === d).length]));
  meta.generatedAt = RETIRED_AT;
  meta.examGroupRetirement = {
    date: RETIRED_AT, ids: RETIRED_EXAM_GROUP_IDS, reason: EXAM_GROUP_RETIREMENT_REASON, scope: EXAM_GROUP_RETIREMENT_SCOPE,
  };
  writeFileSync(metaUrl, `${JSON.stringify(meta, null, 1)}\n`);
  writeFileSync(auditUrl, `${JSON.stringify(audit, null, 1)}\n`);
}

console.log(JSON.stringify({
  dryRun: DRY, changed: changed.length, alreadyRetired: already.length,
  bank: { total: bank.length, valid: valid.length, retired: retired.length, defaultRunCount },
  meta: { version: '1.39.0', validCount: valid.length, retiredCount: changed.length },
  reasoning_mathValid: valid.filter(s => s.dimension === 'reasoning_math').length,
}, null, 2));
for (const c of changed) console.log(`  retired ${c.id}  (${c.points}分, group=${c.groupId})`);

if (APPLY_API && !DRY) {
  let ok = 0, fail = 0;
  for (const id of RETIRED_EXAM_GROUP_IDS) {
    try {
      const res = await fetch(`${BASE}/api/scenarios`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(byId.get(id)), signal: AbortSignal.timeout(30000),
      });
      const body = await res.json();
      if (body.success) ok++; else { fail++; console.error(`  ✗ ${id}: ${body.error}`); }
    } catch (err) { fail++; console.error(`  ✗ ${id}: ${err.message}`); }
  }
  console.log(`API 同步: ok=${ok} fail=${fail}`);
  if (fail) process.exitCode = 1;
}
