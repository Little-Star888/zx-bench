// ============================================================
// 重写 MX3-13 的四问为「四种动作」并同步题库（2026-09-16）
//
// 背景：旧版四问本质都是「算一个精确行列式」，只在规模/是否加边约束上有差异
// → 测耐力而非能力。更严重：旧 P2/P3 的答案是 31 位整数，而考试策略 tools=false，
// 纯推理只能走 8 次代数数域上的 39 因子乘积 → 无工具下不可达（实测 MX3-13-P2
// HARD_TIME_LIMIT 360s + 输出 0 字符），对任何模型都是 0。
//
// 新版四问 = 正算 / 条件算 / 谱结构 / 同构分类，答案依次为
//   3528 | 40500 + 18225 | 19 + 3 | 18 + 13 + 17
// 全部经双路独立复核（矩阵树 vs 谱公式、边收缩 vs 容斥、手工核验碰撞、
// 乘子判据 vs 精确整数特征多项式聚类）。
//
// 用法:
//   node scripts/upgrade-exam-mx313-actions.mjs                 # 默认 dry-run，只打印
//   node scripts/upgrade-exam-mx313-actions.mjs --apply         # 写 benchmark.json + 审计
//   node scripts/upgrade-exam-mx313-actions.mjs --apply --apply-api   # 再 upsert 进 DB
//
// 只改被重写小问的 promptTemplate / requirements / tags / scenarioVersion，
// 其余字段原样保留。题目 id 不变（MX3-13-P1..P4），历史 run 行不受影响。
//
// 注意：本脚本默认 dry-run（与 sync-math-reference-contracts.mjs 一致），
// 不同于 upgrade-exam-warmup-parts.mjs 的「默认写盘」。安全优先。
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { buildExamPaper } from '../packages/core/dist/evaluationLab/examExpansion/index.js';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const APPLY = process.argv.includes('--apply');
const APPLY_API = process.argv.includes('--apply-api');
const BASE = process.env.BASE_URL || 'http://localhost:3001';

const GROUP = 'MX3-13';
const NEXT_VERSION = '1.1.0';
// 1.1.0 也在允许基线内：本轮先落了一版，随后修正 P4 措辞的歧义
// （「与 G_3 同构的那个 d」会被读成 d=3 自身），属同一次升级的迭代。
const PREVIOUS_VERSIONS = ['1.0.0', '1.1.0'];

// 期望答案：写死在这里，作为「生成器算错就立刻停」的独立闸门。
// 与 tmp/_zx_math/mx313_verify.py 的双路复核结果一致。
const EXPECTED = {
  'MX3-13-P1': { tree_count: '3528' },
  'MX3-13-P2': { tree_count: '40500', with_edge: '18225' },
  'MX3-13-P3': { distinct_eigs: '19', max_mult: '3' },
  'MX3-13-P4': { class_count: '18', iso_of_3: '13', iso_of_7: '17' },
};

const bankUrl = new URL('../data/scenarios/benchmark.json', import.meta.url);
const metaUrl = new URL('../data/scenarios/benchmark-meta.json', import.meta.url);
const auditUrl = new URL('../data/scenarios/exam-mx313-rewrite-2026-09-16.json', import.meta.url);

const bank = JSON.parse(readFileSync(bankUrl, 'utf8'));
const byId = new Map(bank.map(s => [s.id, s]));
const paper = buildExamPaper({ groupIds: [GROUP] });

// ---- 闸门 1：生成器算出来的答案必须等于写死的期望值 ----
const answerGate = [];
for (const part of paper.parts) {
  const want = EXPECTED[part.id];
  if (!want) throw new Error(`Unexpected part in ${GROUP}: ${part.id}`);
  const got = Object.fromEntries(part.items.map(x => [x.key, x.expected]));
  const wantKeys = Object.keys(want).sort().join(',');
  const gotKeys = Object.keys(got).sort().join(',');
  if (wantKeys !== gotKeys) throw new Error(`${part.id} item keys ${gotKeys} != expected ${wantKeys}`);
  for (const k of Object.keys(want)) {
    if (got[k] !== want[k]) throw new Error(`${part.id}.${k} = ${got[k]}, expected ${want[k]}`);
  }
  answerGate.push({ id: part.id, answers: got });
}

// ---- 闸门 2：题面必须列出全部评分项 key，且印出的时限 == 执行的 hardSeconds ----
// （与 packages/core/src/evaluationLab/paperSyncGuard.test.ts 同一条不变量）
for (const part of paper.parts) {
  const prompt = part.question.messages[0].content;
  for (const item of part.items) {
    if (!prompt.includes(item.key)) throw new Error(`${part.id} 题面缺少评分项 key: ${item.key}`);
  }
  if (!prompt.includes(`时限${part.hardSeconds}秒`)) throw new Error(`${part.id} 题面时限与 hardSeconds 不一致`);
  if (part.points !== part.items.reduce((s, i) => s + i.points, 0)) throw new Error(`${part.id} 分值合计不符`);
}

const changed = [], already = [], notInBank = [], refused = [];
for (const part of paper.parts) {
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
  const before = {
    prompt: scenario.promptTemplate,
    version: scenario.scenarioVersion,
    hash: scenario.requirements?.questionHash,
    points: scenario.requirements?.points,
    hardSeconds: scenario.requirements?.hardSeconds,
    tags: [...(scenario.tags ?? [])],
  };
  scenario.promptTemplate = prompt;
  // hardSeconds / points 必须与题面里印出的数值一起更新：
  // hardSeconds 走 orchestrator → params.hardTimeoutMs → caller 的题级预算，
  // 不同步就会出现「题面写 600 秒、实际 300 秒被切断」。本轮 hardSeconds 未变
  // （用户选择「接受现状」），但仍按题包回写以保证自洽。
  scenario.requirements = {
    ...scenario.requirements,
    questionHash: part.question.questionHash,
    points: part.points,
    hardSeconds: part.hardSeconds,
  };
  // 历史遗留错标：tags 里的 timeout_*s 是「时限倒挂」那版的残留
  // （P2 写 360s 实际 600s、P3 写 1200s 实际 900s），一并修正为执行值。
  const tags = (scenario.tags ?? []).filter(t => !/^timeout_\d+s$/.test(t) && !/^points_\d+$/.test(t));
  tags.push(`points_${part.points}`, `timeout_${part.hardSeconds}s`);
  scenario.tags = tags;
  scenario.scenarioVersion = NEXT_VERSION;
  scenario.scenarioHash = hashScenarioShort(scenario);
  changed.push({
    id: part.id,
    points: part.points,
    hardSeconds: part.hardSeconds,
    version: `${before.version} -> ${NEXT_VERSION}`,
    hashBefore: before.hash, hashAfter: part.question.questionHash,
    pointsBefore: before.points,
    tagsBefore: before.tags, tagsAfter: tags,
    oldTask: (before.prompt.match(/本问[：:]([^\n]*)/) ?? [])[1] ?? null,
    newTask: (prompt.match(/本问[：:]([^\n]*)/) ?? [])[1] ?? null,
    answers: Object.fromEntries(part.items.map(x => [x.key, x.expected])),
  });
}

const report = {
  dryRun: !APPLY, group: GROUP, version: paper.policy.version, sourceIdentity: paper.sourceIdentity,
  answerGate, changedCount: changed.length, alreadyUpgraded: already, notInBank, refused,
};
console.log(JSON.stringify(report, null, 1));
for (const c of changed) {
  console.log(`\n  ${c.id}  ${c.points}分  ${c.hardSeconds}s  ${c.version}`);
  console.log(`    ${c.oldTask ?? '?'}`);
  console.log(`      ->  ${c.newTask ?? '?'}`);
  console.log(`    答案: ${JSON.stringify(c.answers)}`);
}
if (refused.length) { console.error('\n拒绝改写（非预期基线版本）:', refused); process.exitCode = 1; }
if (notInBank.length) console.error('不在题库:', notInBank);

if (APPLY) {
  const audit = {
    date: '2026-09-16T00:00:00.000Z', dimension: 'reasoning_math', grader: 'ultra_batch_part', group: GROUP,
    reason: '旧四问动作同质（都是精确行列式，只在规模/边约束上有差异）；且旧 P2/P3 答案为 31 位整数，'
      + '在 tools=false 的考试里纯推理不可达 → 对任何模型都是 0 分噪声。',
    designPrinciple: '每一问的最短可算路径必须落在纯推理预算内；难度来自洞察，不来自规模。',
    iterations: 'v8 首次落库后、任何评测开跑之前，修正了 P4 的措辞歧义：'
      + '原句「与 G_3 同构的那个 d」会让模型把 d=3 自身也算作答案（G_3 与自身同构），'
      + '可能造成假阴性；已改为「在 d≠3 中与 G_3 同构的那个 d」。答案与分值不变。',
    newActions: { P1: '正算（矩阵树）', P2: '条件算（边收缩 tau(G含e)=tau(G/e)）',
      P3: '谱结构（DFT 对角化 + 诚实去重，含 lambda_10=lambda_20=8 碰撞陷阱）', P4: '同构分类（乘子判据）' },
    verification: '双路独立复核：矩阵树 vs 谱公式；边收缩 vs 容斥 tau(G)-tau(G-e)；'
      + '手工核验 cos 取值；乘子判据 vs 精确整数特征多项式指纹聚类。',
    timeBudgetPolicy: 'hardSeconds 与 points 均未改动（用户选择「接受现状」）。',
    tagFix: '同时修正 tags 中历史遗留的 timeout_*s 错标（旧值来自时限倒挂版本）。',
    fromScenarioVersion: PREVIOUS_VERSIONS, toScenarioVersion: NEXT_VERSION,
    changed, alreadyUpgraded: already, notInBank,
  };
  writeFileSync(bankUrl, `${JSON.stringify(bank, null, 1)}\n`);
  const meta = JSON.parse(readFileSync(metaUrl, 'utf8'));
  meta.generatedAt = audit.date;
  writeFileSync(metaUrl, `${JSON.stringify(meta, null, 1)}\n`);
  writeFileSync(auditUrl, `${JSON.stringify(audit, null, 1)}\n`);
  console.log(`\nbenchmark.json 已更新（${changed.length} 行）；审计 -> exam-mx313-rewrite-2026-09-16.json`);
  console.log('下一步：node scripts/refresh-benchmark-hashes.mjs 然后本脚本 --apply --apply-api');
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
