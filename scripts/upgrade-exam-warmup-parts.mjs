// ============================================================
// 升级 MX3 组的热身小问（P1）为去白送分版本（2026-09-16）
//
// 用法: node scripts/upgrade-exam-warmup-parts.mjs [--dry-run] [--apply-api]
//
// 只改被替换小问的 promptTemplate / questionHash / scenarioVersion，
// 其余字段与其它小问原样保留。题目 id 不变（MX3-xx-P1），历史 run 行不受影响。
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { buildExamPaper } from '../packages/core/dist/evaluationLab/examExpansion/index.js';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const DRY = process.argv.includes('--dry-run');
const APPLY_API = process.argv.includes('--apply-api');
const BASE = process.env.BASE_URL || 'http://localhost:3001';
const NEXT_VERSION = '1.2.0';
const PREVIOUS_VERSIONS = ['1.0.0', '1.1.0'];

const bankUrl = new URL('../data/scenarios/benchmark.json', import.meta.url);
const metaUrl = new URL('../data/scenarios/benchmark-meta.json', import.meta.url);
const auditUrl = new URL('../data/scenarios/exam-warmup-upgrade-2026-09-16.json', import.meta.url);

const bank = JSON.parse(readFileSync(bankUrl, 'utf8'));
const byId = new Map(bank.map(s => [s.id, s]));
const paper = buildExamPaper();
const targets = paper.parts.filter(p => p.number === 1); // 每个 MX3 组的热身小问

const changed = [], already = [], notInBank = [];
for (const part of targets) {
  const scenario = byId.get(part.id);
  // 题包有 12 组，但发布清单只选了其中一部分进 benchmark.json —— 未发布的不改也不报错。
  if (!scenario) { notInBank.push(part.id); continue; }
  if (scenario.dimension !== 'reasoning_math' || scenario.grader !== 'ultra_batch_part') {
    throw new Error(`${part.id} 不是 reasoning_math/ultra_batch_part，拒绝改写`);
  }
  const prompt = part.question.messages[0].content;
  if (scenario.promptTemplate === prompt && scenario.scenarioVersion === NEXT_VERSION
      && scenario.requirements?.hardSeconds === part.hardSeconds) { already.push(part.id); continue; }
  if (!PREVIOUS_VERSIONS.includes(scenario.scenarioVersion)) {
    throw new Error(`${part.id} scenarioVersion=${scenario.scenarioVersion}，非预期基线`);
  }
  const before = scenario.promptTemplate;
  const beforeSeconds = scenario.requirements?.hardSeconds ?? null;
  scenario.promptTemplate = prompt;
  // hardSeconds 决定真实超时（orchestrator → params.hardTimeoutMs → caller 的题级预算），
  // 必须与题面里印出的时限一起更新，否则模型被告知"600秒"却仍在 180 秒被切断。
  scenario.requirements = {
    ...scenario.requirements,
    questionHash: part.question.questionHash,
    points: part.points,
    hardSeconds: part.hardSeconds,
  };
  scenario.scenarioVersion = NEXT_VERSION;
  scenario.scenarioHash = hashScenarioShort(scenario);
  changed.push({ id: part.id, points: part.points, hardSeconds: part.hardSeconds,
    hardSecondsBefore: beforeSeconds, promptChanged: before !== prompt,
    oldTask: (before.match(/本问[：:]([^\n]*)/) ?? [])[1] ?? null,
    newTask: (prompt.match(/本问[：:]([^\n]*)/) ?? [])[1] ?? null });
}
if (already.length && changed.length === 0 && !DRY) console.log('已是目标版本，无改动');

const audit = { date: '2026-09-16T00:00:00.000Z', dimension: 'reasoning_math', grader: 'ultra_batch_part',
  reason: 'warm-up parts previously required no computation (e.g. "value of the zero vector", "sum of one column")',
  policy: 'every part still totals its original points; gold recomputed and independently cross-checked',
  timeBudgetPolicy: 'P1 raised from the pack default 180s to the project reference default 600s (caller.ts 600_000); P2-P4 unchanged',
  fromScenarioVersion: PREVIOUS_VERSIONS, toScenarioVersion: NEXT_VERSION, changed, alreadyUpgraded: already,
  notInBank };

if (!DRY) {
  writeFileSync(bankUrl, `${JSON.stringify(bank, null, 1)}\n`);
  const meta = JSON.parse(readFileSync(metaUrl, 'utf8'));
  meta.version = '1.36.0';
  meta.generatedAt = audit.date;
  writeFileSync(metaUrl, `${JSON.stringify(meta, null, 1)}\n`);
  writeFileSync(auditUrl, `${JSON.stringify(audit, null, 1)}\n`);
}

console.log(JSON.stringify({ dryRun: DRY, targets: targets.length, changed: changed.length, alreadyUpgraded: already.length, notInBank }, null, 1));
for (const c of changed) {
  console.log(`  ${c.id}  ${c.points}分  ${c.oldTask ?? '?'}\n         -> ${c.newTask ?? '?'}`);
}

if (APPLY_API && !DRY) {
  let ok = 0, fail = 0;
  for (const c of changed) {
    try {
      const res = await fetch(`${BASE}/api/scenarios`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(byId.get(c.id)) });
      const body = await res.json();
      if (body.success) ok++; else { fail++; console.error(`  ✗ ${c.id}: ${body.error}`); }
    } catch (err) { fail++; console.error(`  ✗ ${c.id}: ${err.message}`); }
  }
  console.log(`API 同步: ok=${ok} fail=${fail}`);
  if (fail) process.exitCode = 1;
}
