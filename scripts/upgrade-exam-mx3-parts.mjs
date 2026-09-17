// ============================================================
// MX3 题组的**就地升级**（改题面 / 评分项 / gold，不新增题）
//
// 用法:
//   node scripts/upgrade-exam-mx3-parts.mjs [--apply] [--apply-api]
//     --apply      写 benchmark.json + 审计文件
//     --apply-api  再 upsert 进 DB（需要同时给 --apply）
//
// 设计要点
//  1. **只处理 EXPECTED 白名单里的题**，其余原样跳过 ⇒ 可增量、可重复执行（幂等）。
//  2. **闸门 1**：生成器算出的答案必须等于这里写死的期望值 —— 生成器算错就立刻停。
//  3. **闸门 2**：题面必须含全部评分项 key；印出的时限 == requirements.hardSeconds；分值合计相符。
//  4. 只改 promptTemplate / requirements / tags / scenarioVersion，题目 id 不变，历史 run 行不受影响。
//
// ⚠️ 执行前必须确保没有 run 在跑：`ultra_batch_part` 的评卷表在**服务端启动时**构建，
//    而题面是每题从 DB 实时读 —— 重叠会出现「新题面(新 key) vs 旧评卷表(旧 key)」的假 0 分。
//
// 历次内容
//   2026-09-17 R1：MX3-22/23 改写为「无工具可达」（p=10007 → 小素数；迭代 184 → ≤63）
//   2026-09-17 R2：MX3-21-P4 的 count_at_max → counting_bound
//   2026-09-17 R3（本轮）：修掉三处**组内答案泄漏**
//     · MX3-03-P1  row_min_sum(44) → col_min_sum(42)   —— 旧值恰等于 P2 的 value，等于送答案
//     · MX3-11-P4  count(恒为 36，与 P3 撞) → odd_count(18)
//     · MX3-14-P4  给定 (a3,a4)=(43,113)→(51,129)，真值 (a0,a1)=(3,7)→(4,9)  —— 旧 a1=7 与 P3 的 n_zero=7 撞
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { buildExamPaper } from '../packages/core/dist/evaluationLab/examExpansion/index.js';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const APPLY = process.argv.includes('--apply');
const APPLY_API = process.argv.includes('--apply-api');
const BASE = process.env.BASE_URL || 'http://localhost:3001';
const NEXT_VERSION = '1.1.0';
// 1.2.0 来自 upgrade-exam-warmup-parts.mjs（P1 题面 + hardSeconds 同步，1.0.0→1.1.0→1.2.0）
const PREVIOUS_VERSIONS = ['1.0.0', '1.1.0', '1.2.0'];
const ROUND = 3;
const META_VERSION = '1.41.0';

// 涉及的题组（buildExamPaper 需要它们来还原题面）
const GROUPS = ['MX3-03', 'MX3-11', 'MX3-14', 'MX3-15', 'MX3-16', 'MX3-21', 'MX3-22', 'MX3-23'];

// 期望答案：写死在这里，作为「生成器算错就立刻停」的独立闸门。
// 与 tmp/_zx_math/verify_leakfix2.py、verify_hard12.py、verify_hard13.py 的结论一致。
const EXPECTED = {
  'MX3-03-P1': { row_min: ['8', '7', '6', '8', '7', '8'], col_min_sum: '42' },
  'MX3-11-P4': { odd_count: '18', histogram: [['2', '18'], ['10', '12'], ['11', '4'], ['12', '2']] },
  'MX3-14-P4': { a0: '4', a1: '9' },
};

const bankUrl = new URL('../data/scenarios/benchmark.json', import.meta.url);
const metaUrl = new URL('../data/scenarios/benchmark-meta.json', import.meta.url);
const auditUrl = new URL(`../data/scenarios/exam-mx3-part-upgrade-2026-09-17-round${ROUND}.json`, import.meta.url);

const bank = JSON.parse(readFileSync(bankUrl, 'utf8'));
const byId = new Map(bank.map(s => [s.id, s]));
const paper = buildExamPaper({ groupIds: GROUPS });
const targets = paper.parts.filter(p => EXPECTED[p.id]);

// ---- 闸门 1 ----
const answerGate = [];
for (const part of targets) {
  const want = EXPECTED[part.id];
  const got = Object.fromEntries(part.items.map(x => [x.key, String(x.expected)]));
  const wantKeys = Object.keys(want).sort().join(',');
  const gotKeys = Object.keys(got).sort().join(',');
  if (wantKeys !== gotKeys) throw new Error(`${part.id} item keys ${gotKeys} != expected ${wantKeys}`);
  for (const k of Object.keys(want)) {
    if (String(got[k]) !== String(want[k])) throw new Error(`${part.id}.${k} = ${got[k]}, expected ${want[k]}`);
  }
  answerGate.push({ id: part.id, answers: got });
}

// ---- 闸门 2 ----
for (const part of targets) {
  const prompt = part.question.messages[0].content;
  for (const item of part.items) {
    if (!prompt.includes(item.key)) throw new Error(`${part.id} 题面缺少评分项 key: ${item.key}`);
  }
  if (!prompt.includes(`时限${part.hardSeconds}秒`)) throw new Error(`${part.id} 题面时限与 hardSeconds 不一致`);
  if (part.points !== part.items.reduce((s, i) => s + i.points, 0)) throw new Error(`${part.id} 分值合计不符`);
}

const changed = [], already = [], notInBank = [], refused = [];
for (const part of targets) {
  const scenario = byId.get(part.id);
  if (!scenario) { notInBank.push(part.id); continue; }
  if (scenario.dimension !== 'reasoning_math' || scenario.grader !== 'ultra_batch_part') {
    throw new Error(`${part.id} 不是 reasoning_math/ultra_batch_part，拒绝改写`);
  }
  const prompt = part.question.messages[0].content;
  if (scenario.promptTemplate === prompt
      && scenario.scenarioVersion === NEXT_VERSION
      && scenario.requirements?.questionHash === part.question.questionHash) {
    already.push(part.id);
    continue;
  }
  if (!PREVIOUS_VERSIONS.includes(scenario.scenarioVersion)) {
    refused.push({ id: part.id, scenarioVersion: scenario.scenarioVersion });
    continue;
  }
  const before = { prompt: scenario.promptTemplate, version: scenario.scenarioVersion };
  scenario.promptTemplate = prompt;
  scenario.requirements = {
    ...scenario.requirements,
    questionHash: part.question.questionHash,
    points: part.points,
    hardSeconds: part.hardSeconds,
  };
  const tags = (scenario.tags ?? []).filter(t => !/^timeout_\d+s$/.test(t) && !/^points_\d+$/.test(t));
  tags.push(`points_${part.points}`, `timeout_${part.hardSeconds}s`);
  scenario.tags = tags;
  scenario.scenarioVersion = NEXT_VERSION;
  scenario.scenarioHash = hashScenarioShort(scenario);
  changed.push({
    id: part.id, points: part.points, hardSeconds: part.hardSeconds,
    version: `${before.version} -> ${NEXT_VERSION}`,
    oldTask: (before.prompt.match(/本问[：:]([^\n]*)/) ?? [])[1] ?? null,
    newTask: (prompt.match(/本问[：:]([^\n]*)/) ?? [])[1] ?? null,
    answers: Object.fromEntries(part.items.map(x => [x.key, String(x.expected)])),
  });
}

console.log(JSON.stringify({
  dryRun: !APPLY, round: ROUND, groups: GROUPS, version: paper.policy.version,
  sourceIdentity: paper.sourceIdentity, targets: targets.map(t => t.id),
  answerGate, changedCount: changed.length, alreadyUpgraded: already, notInBank, refused,
}, null, 1));
for (const c of changed) {
  console.log(`\n  ${c.id}  ${c.points}分  ${c.hardSeconds}s  ${c.version}`);
  console.log(`    ${(c.oldTask ?? '?').slice(0, 110)}`);
  console.log(`      ->  ${(c.newTask ?? '?').slice(0, 110)}`);
  console.log(`    答案: ${JSON.stringify(c.answers)}`);
}
if (refused.length) { console.error('\n拒绝改写（非预期基线版本）:', refused); process.exitCode = 1; }
if (notInBank.length) console.error('不在题库:', notInBank);

if (APPLY) {
  const audit = {
    date: '2026-09-17T00:00:00.000Z', round: ROUND, dimension: 'reasoning_math', grader: 'ultra_batch_part',
    groups: GROUPS,
    reason: '组内答案泄漏：progressive exam 会把前面小问的模型回答带进后续小问的上下文，'
      + '所以组内两个小问 gold 相同 = 后面那一档可以直接抄前面，绕过它的概念。',
    findings: {
      'MX3-03-P1': 'row_min_sum(旧 44) 恰等于 P2 的 value(44) —— 该矩阵的最优解取到各行最小值，因此行最小值之和就是最优值',
      'MX3-11-P4': 'count 在 k>=5 后恒为 36，与 P3 的 count(36) 撞；改问解数的奇偶构成',
      'MX3-14-P4': '旧真值 a1=7 与 P3 的 n_zero=7 撞；改用 (a3,a4)=(51,129) → (a0,a1)=(4,9)',
    },
    independentCheck: 'tmp/_zx_math/verify_leakfix2.py：col_min_sum=42≠44；odd_count=18；'
      + '(4,9)↔(51,129) 的系数矩阵 det=−216 与 p 互素 ⇒ 反解唯一；三组组内 gold 互不相同',
    generatorGuard: 'build-exam-expansion.py 新增 assert_distinct()，把「组内 gold 不得重复」写成断言',
    fromScenarioVersion: PREVIOUS_VERSIONS, toScenarioVersion: NEXT_VERSION,
    changed, alreadyUpgraded: already, notInBank,
  };
  writeFileSync(bankUrl, `${JSON.stringify(bank, null, 1)}\n`);
  const meta = JSON.parse(readFileSync(metaUrl, 'utf8'));
  meta.version = META_VERSION;
  meta.generatedAt = audit.date;
  writeFileSync(metaUrl, `${JSON.stringify(meta, null, 1)}\n`);
  writeFileSync(auditUrl, `${JSON.stringify(audit, null, 1)}\n`);
  console.log(`\nbenchmark.json 已更新（${changed.length} 行）；审计 -> exam-mx3-part-upgrade-2026-09-17-round${ROUND}.json`);
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
