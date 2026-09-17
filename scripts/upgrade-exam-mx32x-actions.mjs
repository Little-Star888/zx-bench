// ============================================================
// 把 MX3-21 / MX3-22 / MX3-23 就地在题库中升级为「无工具可达」版本（2026-09-17）
//
// 背景（同一类缺陷）：新出的高难度题组里有几问把答案建立在**大规模枚举**上，
// 在考试策略 tools=false 下对任何模型都不可达 —— 只测耐力不测能力，产出 0 分噪声。
//   MX3-22 旧版：p=10007 的三重特征标和 Σχ(x)χ(x+a)χ(x+b) = #E(F_p) − p − 1，
//     一般 (a,b) 无 CM 结构 ⇒ 无初等闭形式 ⇒ P2 需 10007 项、P3 需 253×10007 ≈ 253 万项。
//     实测：MX3-22-P2 = `HARD_TIME_LIMIT: Model call timed out after 600000ms`，输出 0 字符。
//   MX3-23 旧版：m=97 首次命中 n=153、联合(7,11) n=184，每步都是 9 位数运算。
//   MX3-21 旧版 P4：要求数出 Z_31^* 中规模 5 的 Sidon 集**个数**（gold=6540），
//     必须枚举 C(30,5) = 142,506 个子集。
//
// 改写原则（用户已固化）：难度递增 = **判断难度**递增，不是计算量递增。
//   MX3-22 → 小素数 p ∈ {7,11,13}，改成「计数陷阱」（诱人错答：以为三重和恒为 0）
//   MX3-23 → 保留「先按 M 迭代再判小模数整除」陷阱，模数换成 43/61/17，迭代长度 184 → ≤63
//   MX3-21 → P4 的 count_at_max 换成可推导的 counting_bound（计数上界 7 vs 实际 5）
//
// 用法:
//   node scripts/upgrade-exam-mx32x-actions.mjs                     # 默认 dry-run
//   node scripts/upgrade-exam-mx32x-actions.mjs --apply             # 写 benchmark.json + 审计
//   node scripts/upgrade-exam-mx32x-actions.mjs --apply --apply-api  # 再 upsert 进 DB
//
// 只处理 EXPECTED 里列出的题（其余题原样跳过），因此可增量、可重复执行。
// 只改 promptTemplate / requirements / tags / scenarioVersion，题目 id 不变，历史 run 行不受影响。
// ⚠️ 执行前必须确保没有 run 在跑：ultra_batch_part 的评卷表在服务端启动时构建，
//    而题面是每题从 DB 实时读 —— 重叠会造成「新题面(新 key) vs 旧评卷表(旧 key)」的假 0 分。
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { buildExamPaper } from '../packages/core/dist/evaluationLab/examExpansion/index.js';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const APPLY = process.argv.includes('--apply');
const APPLY_API = process.argv.includes('--apply-api');
const BASE = process.env.BASE_URL || 'http://localhost:3001';

const GROUPS = ['MX3-21', 'MX3-22', 'MX3-23'];
const NEXT_VERSION = '1.1.0';
const PREVIOUS_VERSIONS = ['1.0.0', '1.1.0'];

// 期望答案：写死在这里，作为「生成器算错就立刻停」的独立闸门。
// 与 tmp/_zx_math/verify_hard12.py（欧拉判别）、verify_hard13.py（矩阵快速幂）、
// verify_hard6.py（Sidon 全量枚举）的结论一致。
const EXPECTED = {
  'MX3-21-P4': { max_size: '5', counting_bound: '7' },
  'MX3-22-P1': { pair: '-1' },
  'MX3-22-P2': { zero_pairs: '9' },
  'MX3-22-P3': { nonzero_pairs: '30' },
  'MX3-22-P4': { max_value: '6', argmax_a: '1', argmax_b: '7' },
  'MX3-23-P1': { n7: '8' },
  'MX3-23-P2': { n43: '37' },
  'MX3-23-P3': { n61: '32' },
  'MX3-23-P4': { n2: '63' },
};

const bankUrl = new URL('../data/scenarios/benchmark.json', import.meta.url);
const metaUrl = new URL('../data/scenarios/benchmark-meta.json', import.meta.url);
const auditUrl = new URL('../data/scenarios/exam-mx32x-rewrite-2026-09-17.json', import.meta.url);

const bank = JSON.parse(readFileSync(bankUrl, 'utf8'));
const byId = new Map(bank.map(s => [s.id, s]));
const paper = buildExamPaper({ groupIds: GROUPS });
const targets = paper.parts.filter(p => EXPECTED[p.id]);

// ---- 闸门 1：生成器算出来的答案必须等于写死的期望值 ----
const answerGate = [];
for (const part of targets) {
  const want = EXPECTED[part.id];
  const got = Object.fromEntries(part.items.map(x => [x.key, String(x.expected)]));
  const wantKeys = Object.keys(want).sort().join(',');
  const gotKeys = Object.keys(got).sort().join(',');
  if (wantKeys !== gotKeys) throw new Error(`${part.id} item keys ${gotKeys} != expected ${wantKeys}`);
  for (const k of Object.keys(want)) {
    if (got[k] !== String(want[k])) throw new Error(`${part.id}.${k} = ${got[k]}, expected ${want[k]}`);
  }
  answerGate.push({ id: part.id, answers: got });
}

// ---- 闸门 2：题面必须列出全部评分项 key，且印出的时限 == 执行的 hardSeconds ----
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
  dryRun: !APPLY, groups: GROUPS, version: paper.policy.version,
  sourceIdentity: paper.sourceIdentity, targets: targets.map(t => t.id),
  answerGate, changedCount: changed.length, alreadyUpgraded: already, notInBank, refused,
}, null, 1));
for (const c of changed) {
  console.log(`\n  ${c.id}  ${c.points}分  ${c.hardSeconds}s  ${c.version}`);
  console.log(`    ${(c.oldTask ?? '?').slice(0, 100)}`);
  console.log(`      ->  ${(c.newTask ?? '?').slice(0, 100)}`);
  console.log(`    答案: ${JSON.stringify(c.answers)}`);
}
if (refused.length) { console.error('\n拒绝改写（非预期基线版本）:', refused); process.exitCode = 1; }
if (notInBank.length) console.error('不在题库:', notInBank);

if (APPLY) {
  const audit = {
    date: '2026-09-17T00:00:00.000Z', dimension: 'reasoning_math', grader: 'ultra_batch_part', groups: GROUPS,
    reason: '新出的高难度题组里有几问把答案建立在大规模枚举上，在 tools=false 的考试里纯推理不可达 '
      + '⇒ 对任何模型都是 0 分噪声。实测 MX3-22-P2 产出 HARD_TIME_LIMIT 600s、输出 0 字符。',
    designPrinciple: '难度递增 = 判断难度递增，不是计算量递增；每一问的最短可算路径必须落在纯推理预算内。',
    unreachable: {
      'MX3-22': 'P2 需枚举 10007 项；P3 需 253 × 10007 ≈ 253 万项（三重特征标和 = #E(F_p) − p − 1，无初等闭形式）',
      'MX3-23': 'm=97 需 153 步、联合(7,11) 需 184 步，且每步为 9 位数运算',
      'MX3-21-P4': 'count_at_max 需枚举 C(30,5) = 142,506 个子集',
    },
    reachable: {
      'MX3-22': '最重 p=13 的 66 对 × 13 项 = 858 次基本运算',
      'MX3-23': '最多 63 步',
      'MX3-21-P4': 'counting_bound 可直接由 k(k+1)/2 ≤ 30 推出 = 7',
    },
    verification: {
      'MX3-22': '欧拉判别 χ(a)=a^((p−1)/2) 复核（设计侧用二次剩余查表）',
      'MX3-23': '矩阵快速幂复核（设计侧用逐步递推），前 81 项完全一致',
      'MX3-21': 'verify_hard6.py 以 C(31,7) / C(31,6) 全量枚举证明极值',
    },
    fromScenarioVersion: PREVIOUS_VERSIONS, toScenarioVersion: NEXT_VERSION,
    changed, alreadyUpgraded: already, notInBank,
  };
  writeFileSync(bankUrl, `${JSON.stringify(bank, null, 1)}\n`);
  const meta = JSON.parse(readFileSync(metaUrl, 'utf8'));
  meta.generatedAt = audit.date;
  writeFileSync(metaUrl, `${JSON.stringify(meta, null, 1)}\n`);
  writeFileSync(auditUrl, `${JSON.stringify(audit, null, 1)}\n`);
  console.log(`\nbenchmark.json 已更新（${changed.length} 行）；审计 -> exam-mx32x-rewrite-2026-09-17.json`);
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
