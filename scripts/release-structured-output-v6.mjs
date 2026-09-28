// Publish reviewed definitions only; completed run snapshots and scores are preserved.
import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const apply = process.argv.includes('--apply');
const bankPath = 'data/scenarios/benchmark.json';
const metaPath = 'data/scenarios/benchmark-meta.json';
const bankText = readFileSync(bankPath, 'utf8');
const metaText = readFileSync(metaPath, 'utf8');
const bank = JSON.parse(bankText);
const repairs = new Map(JSON.parse(readFileSync('data/pilots/structured-output-v2-repairs.json', 'utf8')).map(s => [s.id, s]));
const changed = [];
for (let i = 0; i < bank.length; i++) {
  const old = bank[i];
  if (old.dimension !== 'structured_output' || old.status !== 'valid' || old.graderVersion === 'schema_compliance_v6') continue;
  const next = structuredClone(repairs.get(old.id) ?? old);
  if (!repairs.has(old.id)) {
    const version = old.scenarioVersion.split('.').map(Number);
    version[2] += 1;
    next.scenarioVersion = version.join('.');
  }
  next.graderVersion = 'schema_compliance_v6';
  next.scenarioHash = hashScenarioShort(next);
  bank[i] = next;
  changed.push(next);
}
const db = new DatabaseSync('apps/data/zxbench.db', { readOnly: !apply });
const active = () => db.prepare("SELECT count(*) n FROM EvalRun WHERE status IN ('running','pending','queued')").get().n;
if (active()) throw Error('An evaluation is active; release deferred');
for (const s of changed) {
  const row = db.prepare('SELECT scenarioHash FROM ScenarioDefinition WHERE id=?').get(s.id);
  const original = JSON.parse(bankText).find(x => x.id === s.id);
  if (!row || row.scenarioHash !== original.scenarioHash) throw Error(`Bank/database drift: ${s.id}`);
}
if (!apply || !changed.length) {
  console.log(JSON.stringify({ apply, changed: changed.length }));
  db.close();
  process.exit(0);
}
const dir = `logs/structured-output-v6-release-${Date.now()}`;
mkdirSync(dir, { recursive: true });
await backup(db, `${dir}/before.sqlite`);
copyFileSync(bankPath, `${dir}/benchmark.json`);
copyFileSync(metaPath, `${dir}/benchmark-meta.json`);
const meta = JSON.parse(metaText);
const version = meta.version.split('.').map(Number);
version[1] += 1;
version[2] = 0;
meta.version = version.join('.');
meta.generatedAt = new Date().toISOString();
meta.structuredOutputReview = { ...meta.structuredOutputReview,
  version: 'schema-compliance-2026-09-26-v6', grader: 'schema_compliance@schema_compliance_v6',
  count: bank.filter(s => s.dimension === 'structured_output' && s.status === 'valid').length,
  repairedQuestions: [...repairs.keys()], strictContractAudit: true,
  ruleLanguage: [...new Set([...(meta.structuredOutputReview?.ruleLanguage ?? []), 'jsonEq'])],
};
db.exec('BEGIN IMMEDIATE');
try {
  if (active()) throw Error('Evaluation started before release');
  const update = db.prepare('UPDATE ScenarioDefinition SET requirements=?, graderVersion=?, scenarioVersion=?, scenarioHash=?, updatedAt=? WHERE id=?');
  for (const s of changed) update.run(JSON.stringify(s.requirements), s.graderVersion, s.scenarioVersion, s.scenarioHash, Date.now(), s.id);
  writeFileSync(bankPath, JSON.stringify(bank, null, 1) + '\n');
  writeFileSync(metaPath, JSON.stringify(meta, null, 1) + '\n');
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  writeFileSync(bankPath, bankText);
  writeFileSync(metaPath, metaText);
  throw error;
} finally { db.close(); }
const report = { version: meta.version, changed: changed.length, repaired: [...repairs.keys()], backup: dir, releasedAt: meta.generatedAt };
writeFileSync(`${dir}/release.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
