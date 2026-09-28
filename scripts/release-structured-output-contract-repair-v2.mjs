// Publish audited contract repairs while preserving completed evaluation history.
import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const apply = process.argv.includes('--apply');
const bankPath = 'data/scenarios/benchmark.json';
const metaPath = 'data/scenarios/benchmark-meta.json';
const originalBank = readFileSync(bankPath, 'utf8');
const originalMeta = readFileSync(metaPath, 'utf8');
const bank = JSON.parse(originalBank);
const candidates = JSON.parse(readFileSync('data/pilots/structured-output-contract-repair-v2.json', 'utf8'));
if (candidates.length !== 15 || new Set(candidates.map(s => s.id)).size !== 15) throw Error('Expected fifteen distinct candidates');
const db = new DatabaseSync('apps/data/zxbench.db', { readOnly: !apply });
const active = () => db.prepare("SELECT count(*) n FROM EvalRun WHERE status IN ('running','pending','queued')").get().n;
if (active()) throw Error('Evaluation is active');
for (const next of candidates) {
  const index = bank.findIndex(s => s.id === next.id);
  if (index < 0 || bank[index].dimension !== 'structured_output' || bank[index].status !== 'valid') throw Error(`Invalid ${next.id}`);
  if (next.scenarioHash !== hashScenarioShort(next)) throw Error(`Bad candidate hash ${next.id}`);
  const stored = db.prepare('SELECT scenarioHash FROM ScenarioDefinition WHERE id=?').get(next.id);
  if (stored?.scenarioHash !== bank[index].scenarioHash) throw Error(`Bank/database drift ${next.id}`);
  bank[index] = next;
}
if (!apply) {
  console.log(JSON.stringify({ dryRun: true, count: candidates.length, ids: candidates.map(s => s.id) }));
  db.close(); process.exit(0);
}
const dir = `logs/structured-output-contract-repair-v2-${Date.now()}`;
mkdirSync(dir, { recursive: true });
await backup(db, `${dir}/before.sqlite`);
copyFileSync(bankPath, `${dir}/benchmark.json`);
copyFileSync(metaPath, `${dir}/benchmark-meta.json`);
const meta = JSON.parse(originalMeta);
const version = meta.version.split('.').map(Number);
version[1]++; version[2] = 0;
meta.version = version.join('.');
meta.generatedAt = new Date().toISOString();
meta.structuredOutputReview = { ...meta.structuredOutputReview,
  contractRepairV2: { version: meta.version, count: candidates.length, ids: candidates.map(s => s.id),
    note: 'Fixed scorer coverage and two ambiguous prompt contracts; completed runs retain original scores' } };
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
  writeFileSync(bankPath, originalBank);
  writeFileSync(metaPath, originalMeta);
  throw error;
} finally { db.close(); }
writeFileSync(`${dir}/release.json`, JSON.stringify({ version: meta.version, count: candidates.length,
  backup: dir, releasedAt: meta.generatedAt }, null, 2) + '\n');
console.log(JSON.stringify({ version: meta.version, count: candidates.length, backup: dir }));
