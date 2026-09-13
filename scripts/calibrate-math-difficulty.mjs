#!/usr/bin/env node
// ============================================================
// calibrate-math-difficulty.mjs — 基于实测得分的难度校准（P1，2026-09-14）
//
// 背景：reasoning_math 维度实测发现难度标签完全失效（easy 均分 56.6 ≈ hard 54.1），
// 标签与实测难度脱节导致 DIFFICULTY_WEIGHTS 加权失真、报告分层无意义。
// 方法（对应 MathDuels 的 Rasch 思想、MATH 的五档分层）：
//   1. 从 DB 拉取该维度全部实测结果（去重：每 run 每题取最新行）
//   2. 剔除工程失败样本（空输出/评分器缺失/环境故障，与评分管线 P0 口径一致）
//   3. 每题统计：n(模型数)、mean、passRate(>=60)、fullRate、std、区分度
//      （该题得分与模型在其余题上均分的 Pearson 相关，leave-one-out）
//   4. 按 mean 映射建议难度档：>=80 easy / 60~80 medium / 40~60 hard / <40 adversarial
//   5. 标记异常题：死题（mean<10 且 max<30，疑似 gold 错误需人工复核）、
//      低区分题（|discrimination|<0.1，对排名无贡献）
//
// 用法：
//   node scripts/calibrate-math-difficulty.mjs [--db <path>] [--dimension reasoning_math]
//        [--min-models 5] [--apply] [--json <outpath>]
// 默认 dry-run 只打印报告；--apply 会更新 DB ScenarioDefinition.difficulty 与
// data/scenarios/benchmark.json 对应题的 difficulty 字段，并用 core 的
// hashScenarioShort 重算 scenarioHash（difficulty 参与 canonical hash，
// 见 packages/core/src/contracts/canonicalize.ts HASH_FIELDS）。
// ============================================================

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

// ---------- 参数解析 ----------
const args = process.argv.slice(2);
function argValue(name, fallback) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const DB_PATH = path.resolve(REPO_ROOT, argValue('db', 'data/zxbench.db'));
const DIMENSION = argValue('dimension', 'reasoning_math');
const MIN_MODELS = Number(argValue('min-models', 5));
const APPLY = args.includes('--apply');
const JSON_OUT = argValue('json', null);

// ---------- 工程失败分类（与 packages/core/src/scoring.ts classifyEngineeringFailure 口径一致）----------
function classifyEngineeringFailure(row) {
  if (row.environmentError) return 'environment_error';
  let ev = [];
  if (row.evidence) {
    try { const p = JSON.parse(row.evidence); ev = Array.isArray(p) ? p : [row.evidence]; }
    catch { ev = [row.evidence]; }
  }
  if (ev.some((e) => /No evaluator found/i.test(e))) return 'no_evaluator';
  if (ev.some((e) => /^(Empty model output|Model returned empty response)/i.test(e))) return 'empty_output';
  return null;
}

// ---------- 难度档映射（目标通过率带，对应方法论五档压缩到四级体系）----------
const BANDS = [
  { label: 'easy', min: 80, desc: '基本盘（目标通过率 80%+）' },
  { label: 'medium', min: 60, desc: '常规区分（60~80）' },
  { label: 'hard', min: 40, desc: '高区分（40~60）' },
  { label: 'adversarial', min: -Infinity, desc: '天花板/前沿（<40）' },
];
function suggestDifficulty(mean) {
  for (const b of BANDS) if (mean >= b.min) return b.label;
  return 'adversarial';
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    cov += dx * dy; vx += dx * dx; vy += dy * dy;
  }
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : 0;
}

// ---------- 主流程 ----------
if (!fs.existsSync(DB_PATH)) {
  console.error(`DB 不存在: ${DB_PATH}\n用 --db 指定快照库，例如 logs/environment-replay-*/before.sqlite`);
  process.exit(1);
}
const db = new DatabaseSync(DB_PATH, { readOnly: !APPLY });

// 每 run 每题取最新完成行
const rows = db.prepare(`
  SELECT sr.scenarioId, sr.evalRunId, sr.totalScore, sr.environmentError, sr.evidence, sr.finishedAt,
         er.modelConfigId, er.status AS runStatus
  FROM ScenarioResult sr JOIN EvalRun er ON er.id = sr.evalRunId
  WHERE sr.dimension = ? AND sr.totalScore IS NOT NULL AND er.status = 'completed'
  ORDER BY sr.finishedAt ASC
`).all(DIMENSION);

// 去重：(runId, scenarioId) → 最后一行
const latest = new Map();
for (const r of rows) latest.set(`${r.evalRunId}${r.scenarioId}`, r);

// 剔除工程失败，按题聚模型得分；同模型多次 run 取均值
const perScenario = new Map(); // scenarioId -> Map<modelConfigId, number[]>
const exclusions = { environment_error: 0, no_evaluator: 0, empty_output: 0 };
for (const r of latest.values()) {
  const failure = classifyEngineeringFailure(r);
  if (failure) { exclusions[failure]++; continue; }
  if (!perScenario.has(r.scenarioId)) perScenario.set(r.scenarioId, new Map());
  const m = perScenario.get(r.scenarioId);
  if (!m.has(r.modelConfigId)) m.set(r.modelConfigId, []);
  m.get(r.modelConfigId).push(r.totalScore);
}

// 每题每模型均值 → 构建 题 × 模型 矩阵
const scenarioStats = [];
const modelTotals = new Map(); // modelConfigId -> {sum, n}
const matrix = new Map(); // scenarioId -> Map<modelConfigId, number>
for (const [sid, models] of perScenario) {
  const mm = new Map();
  for (const [mid, scores] of models) mm.set(mid, scores.reduce((a, b) => a + b, 0) / scores.length);
  matrix.set(sid, mm);
  for (const [mid, s] of mm) {
    const t = modelTotals.get(mid) || { sum: 0, n: 0 };
    t.sum += s; t.n++;
    modelTotals.set(mid, t);
  }
}

// 当前标签
const currentDefs = new Map();
for (const d of db.prepare(`SELECT id, difficulty, category FROM ScenarioDefinition WHERE dimension = ?`).all(DIMENSION)) {
  currentDefs.set(d.id, d);
}

for (const [sid, mm] of matrix) {
  const scores = [...mm.values()];
  const n = scores.length;
  if (n < MIN_MODELS) continue;
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const sorted = [...scores].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const std = Math.sqrt(scores.reduce((a, s) => a + (s - mean) ** 2, 0) / n);
  const passRate = scores.filter((s) => s >= 60).length / n;
  const fullRate = scores.filter((s) => s >= 99.5).length / n;
  // 区分度：该题得分 vs 模型在其余题上的均分（leave-one-out Pearson）
  const xs = [], ys = [];
  for (const [mid, s] of mm) {
    const t = modelTotals.get(mid);
    if (t.n < 4) continue; // 其余题太少无意义
    xs.push(s); ys.push((t.sum - s) / (t.n - 1));
  }
  const discrimination = pearson(xs, ys);
  const cur = currentDefs.get(sid);
  const suggested = suggestDifficulty(mean);
  const flags = [];
  if (mean < 10 && Math.max(...scores) < 30) flags.push('SUSPECT_GOLD(死题,需人工复核)');
  if (Math.abs(discrimination) < 0.1) flags.push('LOW_DISC(对排名无贡献)');
  if (fullRate > 0.8) flags.push('SATURATED(满分率>80%)');
  scenarioStats.push({
    scenarioId: sid, category: cur?.category ?? '?', currentDifficulty: cur?.difficulty ?? '(无)',
    n, mean: +mean.toFixed(1), median: +median.toFixed(1), std: +std.toFixed(1),
    min: Math.min(...scores), max: Math.max(...scores),
    passRate: +(passRate * 100).toFixed(0), fullRate: +(fullRate * 100).toFixed(0),
    discrimination: +discrimination.toFixed(2), suggestedDifficulty: suggested,
    relabel: cur && cur.difficulty !== suggested, flags,
  });
}

scenarioStats.sort((a, b) => a.mean - b.mean);

// ---------- 报告 ----------
console.log(`\n=== 难度校准报告: ${DIMENSION} ===`);
console.log(`DB: ${DB_PATH}`);
console.log(`有效题数: ${scenarioStats.length}（>= ${MIN_MODELS} 个模型测过）；工程失败剔除: ${JSON.stringify(exclusions)}`);
const bandCounts = {};
for (const s of scenarioStats) bandCounts[s.suggestedDifficulty] = (bandCounts[s.suggestedDifficulty] || 0) + 1;
console.log(`校准后难度分布: ${JSON.stringify(bandCounts)}`);
console.log('');
console.log('scenarioId'.padEnd(26), '类目'.padEnd(22), '现标签'.padEnd(12), '建议'.padEnd(12), 'n'.padStart(3), 'mean'.padStart(6), 'pass%'.padStart(6), 'disc'.padStart(6), '标记');
console.log('-'.repeat(120));
for (const s of scenarioStats) {
  const mark = s.relabel ? '*' : ' ';
  console.log(
    (mark + s.scenarioId).padEnd(26),
    String(s.category).slice(0, 20).padEnd(22),
    String(s.currentDifficulty).padEnd(12),
    String(s.suggestedDifficulty).padEnd(12),
    String(s.n).padStart(3),
    String(s.mean).padStart(6),
    String(s.passRate).padStart(6),
    String(s.discrimination).padStart(6),
    s.flags.join(';'),
  );
}
const relabels = scenarioStats.filter((s) => s.relabel);
console.log(`\n需要重标: ${relabels.length}/${scenarioStats.length} 题（* 标记）`);

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ dimension: DIMENSION, db: DB_PATH, exclusions, bandCounts, scenarios: scenarioStats }, null, 2));
  console.log(`JSON 报告已写入: ${JSON_OUT}`);
}

// ---------- 应用 ----------
if (APPLY && relabels.length > 0) {
  // difficulty 参与 canonical hash → 必须重算 scenarioHash。
  // 哈希口径与 refresh-benchmark-hashes.mjs 一致：对 benchmark.json 的场景对象计算，
  // 再回写 DB（DB 行形态不同，直接哈希 DB 行会得到不同值）。
  const { hashScenarioShort } = await import(pathToFileURL(path.join(REPO_ROOT, 'packages/core/dist/contracts/canonicalize.js')).href);
  const bankPath = path.join(REPO_ROOT, 'data/scenarios/benchmark.json');
  const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
  const bankArr = Array.isArray(bank) ? bank : bank.scenarios;
  const bankById = new Map(bankArr.map((sc) => [sc.id, sc]));

  const now = String(Date.now());
  const update = db.prepare(`UPDATE ScenarioDefinition SET difficulty = ?, scenarioHash = ?, updatedAt = ? WHERE id = ?`);
  let dbCount = 0, fileCount = 0;
  const skipped = [];
  for (const s of relabels) {
    const bankSc = bankById.get(s.scenarioId);
    if (!bankSc) { skipped.push(s.scenarioId + '(不在 benchmark.json)'); continue; }
    bankSc.difficulty = s.suggestedDifficulty;
    const newHash = hashScenarioShort(bankSc);
    bankSc.scenarioHash = newHash;
    fileCount++;
    const row = db.prepare(`SELECT id, scenarioHash FROM ScenarioDefinition WHERE id = ?`).get(s.scenarioId);
    if (row) {
      update.run(s.suggestedDifficulty, newHash, now, s.scenarioId);
      dbCount++;
    }
    s.newHash = newHash;
  }
  fs.writeFileSync(bankPath, JSON.stringify(bankArr, null, 2) + '\n');
  console.log(`[apply] benchmark.json 已更新 ${fileCount} 题；DB 已更新 ${dbCount} 题（difficulty + scenarioHash）`);
  if (skipped.length) console.log(`[apply] 跳过: ${skipped.join(', ')}`);
} else if (relabels.length > 0) {
  console.log(`\n(dry-run) 加 --apply 应用重标；建议先人工复核 SUSPECT_GOLD 题`);
}
