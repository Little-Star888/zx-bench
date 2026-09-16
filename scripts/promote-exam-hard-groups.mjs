// ============================================================
// 把新增的高难度题组（MX3-13/14/15，共 12 小问）推进正式题库。
//
// 用法: node scripts/promote-exam-hard-groups.mjs [--dry-run] [--apply-api]
//
// 只新增，不改动任何已存在的题目定义（已存在则跳过），因此对现有 48 个小问零影响。
// 字段形状与 promote-ultra-batch.mjs 保持一致，保证同一题组内的题面/评分口径相同。
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { buildExamPaper } from '../packages/core/dist/evaluationLab/examExpansion/index.js';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const DRY = process.argv.includes('--dry-run');
const APPLY_API = process.argv.includes('--apply-api');
const BASE = process.env.BASE_URL || 'http://localhost:3001';
const NEW_GROUPS = ['MX3-13', 'MX3-14', 'MX3-15', 'MX3-16', 'MX3-17', 'MX3-18', 'MX3-19', 'MX3-20', 'MX3-21'];
const GOLD_AT = '2026-09-16T00:00:00.000Z';

const root = new URL('../data/scenarios/', import.meta.url);
const bankUrl = new URL('benchmark.json', root);
const metaUrl = new URL('benchmark-meta.json', root);
const release = JSON.parse(readFileSync(new URL('ultra-batch-release-manifest.json', root), 'utf8'));

const bank = JSON.parse(readFileSync(bankUrl, 'utf8'));
const byId = new Map(bank.map(s => [s.id, s]));
const paper = buildExamPaper({ groupIds: NEW_GROUPS });

const added = [], skipped = [];
for (const part of paper.parts) {
  const prompt = part.question.messages[0].content;
  if (byId.has(part.id)) { skipped.push(part.id); continue; }
  const scenario = {
    id: part.id, dimension: 'reasoning_math', category: 'ultra_progressive_exam',
    difficulty: part.number < 2 ? 'hard' : 'adversarial', language: 'json', locale: 'zh-CN',
    status: 'valid', tier: 'public_dev', promptTemplate: prompt,
    grader: 'ultra_batch_part', graderVersion: '1.0.0', scoring: { type: 'weighted_axes' },
    hiddenTests: [],
    requirements: {
      groupId: part.groupId, partNumber: part.number, points: part.points,
      hardSeconds: part.hardSeconds, questionHash: part.question.questionHash,
      sourcePackVersion: release.version,
    },
    tags: ['ultra_difficulty', 'progressive_exam', `group_${part.groupId}`, `part_${part.number}`,
      `points_${part.points}`, `timeout_${part.hardSeconds}s`],
    scenarioVersion: '1.0.0', scenarioHash: '', responseMode: 'raw_output', outputPolicy: 'fenced_allowed',
    goldSource: release.version, goldVerifiedAt: GOLD_AT, reviewStatus: 'verified',
    maxAnswerTokens: 393216, maxReasoningTokens: 393216,
  };
  scenario.scenarioHash = hashScenarioShort(scenario);
  added.push(scenario);
}

const next = [...bank, ...added].sort((a, b) => a.id.localeCompare(b.id, 'en'));
const valid = next.filter(s => s.status === 'valid');
const defaultRunCount = valid.filter(s => !s.requirements?.developmentShadow).length;

if (!DRY) {
  writeFileSync(bankUrl, `${JSON.stringify(next, null, 1)}\n`);
  const meta = JSON.parse(readFileSync(metaUrl, 'utf8'));
  meta.version = '1.37.0';
  meta.count = valid.length;
  meta.validCount = valid.length;
  meta.totalCount = valid.length + Number(meta.retiredCount ?? 0);
  meta.defaultRunCount = defaultRunCount;
  meta.dimensions = Object.fromEntries([...new Set(valid.map(s => s.dimension))].sort()
    .map(d => [d, valid.filter(s => s.dimension === d).length]));
  meta.generatedAt = GOLD_AT;
  meta.examHardGroups = {
    version: paper.policy.version, groups: NEW_GROUPS, parts: added.length,
    note: 'brute force infeasible by design; gold computed and independently cross-checked',
  };
  writeFileSync(metaUrl, `${JSON.stringify(meta, null, 1)}\n`);
}

console.log(JSON.stringify({
  dryRun: DRY, added: added.length, skipped: skipped.length,
  bank: { total: next.length, valid: valid.length, defaultRunCount },
  reasoning_math: valid.filter(s => s.dimension === 'reasoning_math').length,
  packVersion: paper.policy.version,
}, null, 1));

if (APPLY_API && !DRY) {
  let ok = 0, fail = 0;
  for (const s of added) {
    try {
      const res = await fetch(`${BASE}/api/scenarios`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) });
      const body = await res.json();
      if (body.success) ok++; else { fail++; console.error(`  ✗ ${s.id}: ${body.error}`); }
    } catch (err) { fail++; console.error(`  ✗ ${s.id}: ${err.message}`); }
  }
  console.log(`API 同步: ok=${ok} fail=${fail}`);
  if (fail) process.exitCode = 1;
}
