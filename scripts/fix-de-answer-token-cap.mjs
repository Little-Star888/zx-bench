// ============================================================
// 修掉 DE-CN-036..056 的 `maxAnswerTokens = 1024`
//
// 这不是「值偏小」的参数调整，而是一条**静默覆盖**（详见
// reports/reasoning-math-dimension-audit-2026-09-17.md §18.3）：
//   · packages/core/src/orchestrator.ts:75   题级 maxAnswerTokens 无条件覆盖运行级 constraints
//   · packages/core/src/model/caller.ts:382-387
//        defaultMaxTokens = (maxReasoningTokens ?? 0) + (maxAnswerTokens ?? 0)   ← 不是兜底，会覆盖 params.maxTokens
//   · packages/core/src/model/caller.ts:41/:86  → body.max_tokens = defaultMaxTokens
//   ⇒ 题上写 1024，**实发 max_tokens 就是 1024**，运行级 98192 被顶掉。
//     对推理模型，reasoning 会先把 1024 吃掉 ⇒ finishReason=length、content 为空 ⇒ 恒 0 分。
//   ⇒ 还顺带废掉 token 升级重试（buildMessages 每次都重算回 1024），
//     并把旧口径软指令（caller.ts:544-546）拼进 prompt。
//
// 用法:
//   node scripts/fix-de-answer-token-cap.mjs            # dry-run（默认）
//   node scripts/fix-de-answer-token-cap.mjs --apply    # 写 benchmark.json + meta + 审计
//
// 之后必须用**既有**的规范脚本把改动落到 DB（它带备份 / 活跃 run 拒绝 / 历史哈希校验）：
//   node scripts/sync-reviewed-question-contracts.mjs apps/data/zxbench.db --apply
// 再重启服务端（watchdog 10 秒内自动拉起）让新值生效。
//
// 设计要点:
//  1. 白名单 = DE-CN-036..056（21 题），其余原样跳过 ⇒ 幂等、可重复执行。
//  2. 闸门：目标题必须是 data_extraction + json_atomic_fields；maxAnswerTokens ∈ {1024, null}，
//     出现别的值即拒绝（防误伤）。
//  3. **不动 scenarioVersion** —— 题面与判分契约未变，改了会破坏冻结 DE v3 契约的
//     dataExtractionV3.test.ts（它断言 56 题全为 3.0.0）。历史可区分性靠 scenarioHash。
//  4. 改完重算 scenarioHash —— `maxAnswerTokens` 在 canonicalize.ts 的 HASH_FIELDS 里。
//  5. 全局自检：改完后 bank 里**不允许**再存在 (0, 8192) 区间的 maxAnswerTokens；
//     且 393216 组数量、valid 总数都不许变（防误伤其它题）。
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const APPLY = process.argv.includes('--apply');
const ROOT = new URL('..', import.meta.url);
const bankUrl = new URL('data/scenarios/benchmark.json', ROOT);
const metaUrl = new URL('data/scenarios/benchmark-meta.json', ROOT);
const auditUrl = new URL('data/scenarios/de-answer-token-cap-fix-2026-09-17.json', ROOT);
const reportUrl = new URL('tmp/_zx_math/fix_de_token_cap_report.json', ROOT);

const META_VERSION = '1.45.0';
const DATE = '2026-09-17T00:00:00.000Z';
const STALE_VALUE = 1024;
const SAFE_MIN = 8192;   // 守卫下限：< 此值的 maxAnswerTokens 一律视为废口径遗留
const NEXT_VALUE = null; // 落回运行级 maxTokens
const EXPECTED_IDS = Array.from({ length: 21 }, (_, i) => `DE-CN-${String(36 + i).padStart(3, '0')}`);

const bank = JSON.parse(readFileSync(bankUrl, 'utf8'));
const meta = JSON.parse(readFileSync(metaUrl, 'utf8'));
const byId = new Map(bank.map(s => [s.id, s]));

const out = {
  dryRun: !APPLY, date: DATE,
  scope: { dimension: 'data_extraction', grader: 'json_atomic_fields', ids: EXPECTED_IDS },
  from: STALE_VALUE, to: NEXT_VALUE, safeMin: SAFE_MIN,
  metaVersionBefore: meta.version, metaVersionAfter: META_VERSION,
  gates: {}, before: {}, after: {}, changed: [], alreadyFixed: [], refused: [], missing: [],
};

// ---- 前置快照（用来证明「没误伤其它题」）----
const snapshot = (list) => ({
  total: list.length,
  valid: list.filter(s => s.status === 'valid').length,
  cap1024: list.filter(s => s.maxAnswerTokens === STALE_VALUE).length,
  cap393216: list.filter(s => s.maxAnswerTokens === 393216).length,
  capNone: list.filter(s => s.maxAnswerTokens == null).length,
  smallCaps: list.filter(s => typeof s.maxAnswerTokens === 'number' && s.maxAnswerTokens > 0 && s.maxAnswerTokens < SAFE_MIN).length,
});
out.before = snapshot(bank);

// ---- 闸门 + 改写 ----
for (const id of EXPECTED_IDS) {
  const s = byId.get(id);
  if (!s) { out.missing.push(id); continue; }
  if (s.dimension !== 'data_extraction' || s.grader !== 'json_atomic_fields') {
    throw new Error(`${id} 不是 data_extraction/json_atomic_fields（实际 ${s.dimension}/${s.grader}），拒绝改写`);
  }
  if (s.maxAnswerTokens !== STALE_VALUE && s.maxAnswerTokens != null) {
    out.refused.push({ id, maxAnswerTokens: s.maxAnswerTokens });
    continue;
  }
  if (s.maxAnswerTokens == null) { out.alreadyFixed.push(id); continue; }

  const hashBefore = s.scenarioHash;
  s.maxAnswerTokens = NEXT_VALUE;
  s.scenarioHash = hashScenarioShort(s);
  out.changed.push({
    id, category: s.category, difficulty: s.difficulty,
    maxAnswerTokens: `${STALE_VALUE} -> null`,
    scenarioHash: `${hashBefore} -> ${s.scenarioHash}`,
    scenarioVersion: s.scenarioVersion,   // 保持不变，见文件头第 3 条
  });
}

out.gates.missing = out.missing.length === 0;
out.gates.refused = out.refused.length === 0;

// ---- 改后自检 ----
out.after = snapshot(bank);
out.gates.smallCapsEliminated = out.after.smallCaps === 0;
out.gates.validUnchanged = out.after.valid === out.before.valid;
out.gates.cap393216Unchanged = out.after.cap393216 === out.before.cap393216;
out.gates.cap1024Eliminated = out.after.cap1024 === 0;
out.gates.hashesRecomputed = out.changed.every(c => c.scenarioHash.includes('->') && !c.scenarioHash.endsWith('-> '));
out.gates.changedCountIs21 = APPLY
  ? out.changed.length === 21
  : out.changed.length + out.alreadyFixed.length === 21;

const failedGates = Object.entries(out.gates).filter(([, ok]) => !ok).map(([k]) => k);
out.pass = failedGates.length === 0;
out.failedGates = failedGates;

// ---- 全局不变量：bank 里任何 valid 题都不该再有 (0, SAFE_MIN) 区间的上限 ----
const offenders = bank
  .filter(s => typeof s.maxAnswerTokens === 'number' && s.maxAnswerTokens > 0 && s.maxAnswerTokens < SAFE_MIN)
  .map(s => ({ id: s.id, dimension: s.dimension, maxAnswerTokens: s.maxAnswerTokens }));
out.remainingSmallCaps = offenders;
out.pass = out.pass && offenders.length === 0;

writeFileSync(reportUrl, `${JSON.stringify(out, null, 1)}\n`, 'utf8');

if (out.pass && APPLY && out.changed.length > 0) {
  writeFileSync(bankUrl, `${JSON.stringify(bank, null, 1)}\n`, 'utf8');
  meta.version = META_VERSION;
  meta.generatedAt = DATE;
  writeFileSync(metaUrl, `${JSON.stringify(meta, null, 1)}\n`, 'utf8');
  const audit = {
    date: DATE,
    dimension: 'data_extraction',
    grader: 'json_atomic_fields',
    scope: EXPECTED_IDS,
    reason: '这些题的 maxAnswerTokens=1024 是 2026-09-12 的 upgrade-data-extraction-v3.mjs 留下的旧口径值'
      + '（那批题在 answerFirst 口径下造的，后来题面改成「只能输出 JSON」，字段没跟着改）。'
      + '该字段在 caller.ts:385-386 会**静默顶掉运行级 maxTokens**：defaultMaxTokens = 0 + 1024 = 1024，'
      + '导致推理模型的 reasoning 吃光预算、content 为空 ⇒ finishReason=length ⇒ 恒 0 分。',
    mechanism: [
      'orchestrator.ts:75   题级 maxAnswerTokens 无条件覆盖运行级 constraints',
      'caller.ts:382-387    发包前重算 defaultMaxTokens = maxReasoningTokens + maxAnswerTokens（非兜底）',
      'caller.ts:41/:86     body.max_tokens = defaultMaxTokens',
      'caller.ts:544-546    字段非空时还会把「最终答案必须控制在 N 个 token 以内」拼进 prompt',
      'orchestrator.ts:288  token 升级重试 16384/32768/65536 因每次重算而被废掉',
    ],
    evidence: {
      neverSucceeded: 'DE-CN-047 三次 run 输出 token 都恰好 1024（maxTokens 分别 98192/88192/98192）',
      truncatedRows: '7 行 finishReason=length 且输出为空',
      reallyHarmed: ['DE-CN-047（3/3 行全截断，最高分 0）', 'DE-CN-039（最高分 0，其「有信号」是截断假象）'],
      occasional: ['DE-CN-044', 'DE-CN-046', 'DE-CN-051'],
      unaffected: '其余 18 题次次满分（短答案，1024 够用）',
    },
    fromValue: STALE_VALUE,
    toValue: NEXT_VALUE,
    scenarioVersionPolicy: '保持不变（题面与判分契约未变；dataExtractionV3.test.ts 冻结 56 题为 3.0.0）',
    hashPolicy: 'maxAnswerTokens 在 canonicalize.ts HASH_FIELDS 中 ⇒ 同步重算 scenarioHash',
    changed: out.changed,
    alreadyFixed: out.alreadyFixed,
    before: out.before,
    after: out.after,
    guard: `改完后 bank 中不再存在 (0, ${SAFE_MIN}) 区间的 maxAnswerTokens`,
    applyDb: 'node scripts/sync-reviewed-question-contracts.mjs apps/data/zxbench.db --apply',
  };
  writeFileSync(auditUrl, `${JSON.stringify(audit, null, 1)}\n`, 'utf8');
  out.wrote = { bank: 'data/scenarios/benchmark.json', meta: 'data/scenarios/benchmark-meta.json', audit: auditUrl.pathname.split('/').pop() };
  writeFileSync(reportUrl, `${JSON.stringify(out, null, 1)}\n`, 'utf8');
}

if (!out.pass) process.exitCode = 1;
