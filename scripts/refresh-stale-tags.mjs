// ============================================================
// 刷新「陈旧 tag」：把 tags 里的 timeout_Ns / points_N 对齐到 requirements 的真值
//
// 背景（2026-09-18 核查 run 时发现）：
//   MX3 题包后来把 hardSeconds 从 [180,360,?,1200] 改成 [300,600,900,1200]，
//   但**已冻结在题库里的 tags 没跟着改** —— 实测 35 条 `timeout_Ns` 与
//   `requirements.hardSeconds` 不一致（例：MX3-01-P1 tag=timeout_180s / hardSeconds=300）。
//   题面印的「时限N秒」与 hardSeconds 本身是自洽的（164 题逐一比对 0 不一致），
//   所以这纯粹是元数据误导：前端展示、按 tag 筛选、人工判断都会看错。
//   `points_N` 同理（与 requirements.points 比对）。
//
// ⚠️ 为什么不用 `sync-reviewed-question-contracts.mjs`：
//   它的默认列集**不含 tags**，而 `--all-definitions` 会 upsert 全部 849 行（爆炸半径过大）。
//   tags 不在 canonicalize.ts 的 HASH_FIELDS 里 ⇒ 改它**不改变 scenarioHash**，
//   也不影响 eligibility，因此这里用**只改 tags 列**的窄更新 + 备份 + 活 run 拒绝。
//
// 用法:
//   node scripts/refresh-stale-tags.mjs            # dry-run（默认）
//   node scripts/refresh-stale-tags.mjs --apply    # 写 benchmark.json + 审计
//   node scripts/refresh-stale-tags.mjs --apply --apply-db --db apps/data/zxbench.db
//                                                  # 再只更新 DB 的 tags 列
//
// 设计要点:
//  1. 只处理「tag 期望值与 requirements 真值不符」的题，其余原样跳过 ⇒ 幂等。
//  2. 闸门：改完必须证明 scenarioHash 逐题未变（tags 不入哈希）。
//  3. DB 侧只 `UPDATE ScenarioDefinition SET tags=? WHERE id=?`，并核对
//     scenarioHash / reviewStatus / goldVerifiedAt / promptTemplate 未被触碰。
//  4. 有 running/pending/queued 的 run 时拒绝 --apply-db（与既有规范一致）。
// ============================================================
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const APPLY = process.argv.includes('--apply');
const APPLY_DB = process.argv.includes('--apply-db');
const dbArgIdx = process.argv.indexOf('--db');
const DB_PATH = dbArgIdx >= 0 ? process.argv[dbArgIdx + 1] : 'apps/data/zxbench.db';

const ROOT = new URL('..', import.meta.url);
const bankUrl = new URL('data/scenarios/benchmark.json', ROOT);
const metaUrl = new URL('data/scenarios/benchmark-meta.json', ROOT);
const auditUrl = new URL('data/scenarios/stale-tag-refresh-2026-09-18.json', ROOT);
const reportUrl = new URL('tmp/_zx_math/refresh_stale_tags_report.json', ROOT);

const META_VERSION = '1.46.0';
const DATE = '2026-09-18T00:00:00.000Z';

const bank = JSON.parse(readFileSync(bankUrl, 'utf8'));
const meta = JSON.parse(readFileSync(metaUrl, 'utf8'));
const byId = new Map(bank.map(s => [s.id, s]));

const expectedTags = (scenario) => {
  const req = scenario.requirements ?? {};
  const want = new Map();
  if (Number.isInteger(req.points) && req.points > 0) want.set('points', `points_${req.points}`);
  if (Number.isInteger(req.hardSeconds) && req.hardSeconds > 0) want.set('timeout', `timeout_${req.hardSeconds}s`);
  return want;
};

const changed = [];
for (const scenario of bank) {
  const tags = Array.isArray(scenario.tags) ? scenario.tags : null;
  if (!tags || tags.length === 0) continue;
  const want = expectedTags(scenario);
  if (want.size === 0) continue;

  const before = [...tags];
  const after = [];
  const fixes = [];
  for (const tag of tags) {
    const m = /^(points|timeout)_(.+)$/.exec(String(tag));
    const kind = m?.[1];
    if (kind && want.has(kind)) {
      const replacement = want.get(kind);
      if (replacement !== tag) fixes.push({ from: tag, to: replacement });
      after.push(replacement);
      continue;
    }
    after.push(tag);
  }
  // 缺 tag 也算陈旧（例如 requirements 有 hardSeconds 但 tags 里没有 timeout_*）
  for (const [kind, tag] of want.entries()) {
    if (!after.includes(tag) && !after.some(t => new RegExp(`^${kind}_`).test(String(t)))) {
      after.push(tag);
      fixes.push({ from: null, to: tag });
    }
  }
  if (fixes.length === 0) continue;

  const hashBefore = scenario.scenarioHash;
  scenario.tags = after;
  const hashAfter = hashScenarioShort(scenario);
  if (hashAfter !== hashBefore) {
    throw new Error(`${scenario.id}: tags 入了哈希（${hashBefore} -> ${hashAfter}）—— 与假设不符，停止`);
  }
  changed.push({
    id: scenario.id, dimension: scenario.dimension, grader: scenario.grader,
    hardSeconds: scenario.requirements?.hardSeconds, points: scenario.requirements?.points,
    fixes, before, after, scenarioHash: hashBefore,
  });
}

const out = {
  dryRun: !APPLY, date: DATE, total: bank.length, changedCount: changed.length,
  metaVersionBefore: meta.version, metaVersionAfter: META_VERSION,
  changed,
  gates: {
    hashesUntouched: changed.every(c => typeof c.scenarioHash === 'string' && c.scenarioHash.length === 16),
  },
  pass: true,
};
out.pass = Object.values(out.gates).every(Boolean);

writeFileSync(reportUrl, `${JSON.stringify(out, null, 1)}\n`, 'utf8');

if (out.pass && APPLY && changed.length > 0) {
  writeFileSync(bankUrl, `${JSON.stringify(bank, null, 1)}\n`, 'utf8');
  meta.version = META_VERSION;
  meta.generatedAt = DATE;
  writeFileSync(metaUrl, `${JSON.stringify(meta, null, 1)}\n`, 'utf8');
  writeFileSync(auditUrl, `${JSON.stringify({
    date: DATE,
    reason: '题包的 hardSeconds/points 改过，但题库里已冻结的 tags 没跟着改 ⇒ 元数据误导'
      + '（没有任何代码读这些 tag；题面印的时限与 requirements.hardSeconds 本身自洽）',
    tagsNotHashed: 'tags 不在 canonicalize.ts 的 HASH_FIELDS ⇒ scenarioHash 逐题未变（见 gates/changed）',
    changed: changed.map(c => ({ id: c.id, fixes: c.fixes, scenarioHash: c.scenarioHash })),
    fromMetaVersion: out.metaVersionBefore, toMetaVersion: META_VERSION,
  }, null, 1)}\n`, 'utf8');
  out.wrote = { bank: true, meta: true, audit: 'stale-tag-refresh-2026-09-18.json' };
  writeFileSync(reportUrl, `${JSON.stringify(out, null, 1)}\n`, 'utf8');
}

if (APPLY_DB) {
  if (!APPLY) throw new Error('--apply-db 需要同时给 --apply');
  const db = new DatabaseSync(DB_PATH, { readOnly: false });
  const active = db.prepare("SELECT count(*) n FROM EvalRun WHERE status IN ('running','pending','queued')").get().n;
  if (active) throw new Error(`拒绝在活跃 run 期间改定义（active=${active}）`);
  copyFileSync(DB_PATH, `${DB_PATH}.tags-${Date.now()}.bak`);
  const before = db.prepare('SELECT id, tags, scenarioHash, reviewStatus, goldVerifiedAt, substr(promptTemplate,1,40) AS pt FROM ScenarioDefinition WHERE id = ?');
  const update = db.prepare('UPDATE ScenarioDefinition SET tags = ? WHERE id = ?');
  const after = db.prepare('SELECT tags, scenarioHash, reviewStatus, goldVerifiedAt, substr(promptTemplate,1,40) AS pt FROM ScenarioDefinition WHERE id = ?');
  // 以「DB 与题库的 tags 是否一致」驱动，而不是以本次 changed 驱动 ——
  // 这样在题库已改、DB 未改（或反过来）时都能收敛，且重复执行安全。
  const targets = bank
    .filter(s => Array.isArray(s.tags) && s.tags.length > 0)
    .map(s => ({ id: s.id, tags: s.tags }))
    .filter(t => {
      const row = before.get(t.id);
      return row && row.tags !== JSON.stringify(t.tags);
    });
  const dbResult = { candidates: targets.length, updated: 0, mismatched: [], missing: [], notInDb: [] };
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const t of targets) {
      const b = before.get(t.id);
      if (!b) { dbResult.notInDb.push(t.id); continue; }
      update.run(JSON.stringify(t.tags), t.id);
      const a = after.get(t.id);
      const same = a.scenarioHash === b.scenarioHash && a.reviewStatus === b.reviewStatus
        && a.goldVerifiedAt === b.goldVerifiedAt && a.pt === b.pt;
      if (same) dbResult.updated += 1; else dbResult.mismatched.push({ id: t.id, before: b, after: a });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }
  db.close();
  out.dbResult = dbResult;
  out.pass = out.pass && dbResult.mismatched.length === 0;
  writeFileSync(reportUrl, `${JSON.stringify(out, null, 1)}\n`, 'utf8');
  if (!out.pass) process.exitCode = 1;
}

if (!out.pass) process.exitCode = 1;
