// Publish the reviewed candidate definitions, preserving completed evaluation history.
import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const apply = process.argv.includes('--apply');
const bankPath = 'data/scenarios/benchmark.json';
const metaPath = 'data/scenarios/benchmark-meta.json';
const beforeBank = readFileSync(bankPath, 'utf8');
const beforeMeta = readFileSync(metaPath, 'utf8');
const bank = JSON.parse(beforeBank);
const candidates = JSON.parse(readFileSync('data/pilots/structured-output-contract-repair.json', 'utf8'));
if (candidates.length !== 12 || new Set(candidates.map(s => s.id)).size !== 12) throw Error('Expected twelve distinct repairs');
const db = new DatabaseSync('apps/data/zxbench.db', { readOnly: !apply });
const active = () => db.prepare("SELECT count(*) n FROM EvalRun WHERE status IN ('running','pending','queued')").get().n;
if (active()) throw Error('Evaluation is active');
for (const next of candidates) {
  const index = bank.findIndex(s => s.id === next.id);
  if (index < 0 || bank[index].dimension !== 'structured_output' || bank[index].status !== 'valid') throw Error(`Invalid candidate ${next.id}`);
  if (next.scenarioHash !== hashScenarioShort(next)) throw Error(`Bad candidate hash ${next.id}`);
  const stored = db.prepare('SELECT scenarioHash FROM ScenarioDefinition WHERE id=?').get(next.id);
  if (stored?.scenarioHash !== bank[index].scenarioHash) throw Error(`Bank/database drift ${next.id}`);
  bank[index] = next;
}
if (!apply) {
  console.log(JSON.stringify({ dryRun: true, count: candidates.length, ids: candidates.map(s => s.id) }));
  db.close(); process.exit(0);
}
const dir = `logs/structured-output-contract-repair-${Date.now()}`;
mkdirSync(dir, { recursive: true });
await backup(db, `${dir}/before.sqlite`);
copyFileSync(bankPath, `${dir}/benchmark.json`);
copyFileSync(metaPath, `${dir}/benchmark-meta.json`);
const meta = JSON.parse(beforeMeta);
const version = meta.version.split('.').map(Number);
version[1]++; version[2] = 0;
meta.version = version.join('.');
meta.generatedAt = new Date().toISOString();
meta.structuredOutputReview = { ...meta.structuredOutputReview,
  contractRepair: { version: meta.version, count: candidates.length, ids: candidates.map(s => s.id),
    note: 'Explicit constraints and external schema fixtures; SO-CN-053 ambiguity removed' } };
db.exec('BEGIN IMMEDIATE');
try {
  if (active()) throw Error('Evaluation started before publication');
  const update = db.prepare('UPDATE ScenarioDefinition SET promptTemplate=?, requirements=?, scenarioVersion=?, scenarioHash=?, updatedAt=? WHERE id=?');
  for (const s of candidates) update.run(s.promptTemplate, JSON.stringify(s.requirements), s.scenarioVersion, s.scenarioHash, Date.now(), s.id);
  writeFileSync(bankPath, JSON.stringify(bank, null, 1) + '\n');
  writeFileSync(metaPath, JSON.stringify(meta, null, 1) + '\n');
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  writeFileSync(bankPath, beforeBank);
  writeFileSync(metaPath, beforeMeta);
  throw error;
} finally { db.close(); }
const report = { version: meta.version, count: candidates.length, backup: dir, releasedAt: meta.generatedAt };
writeFileSync(`${dir}/release.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
