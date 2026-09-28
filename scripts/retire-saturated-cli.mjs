import fs from 'node:fs';
import { DatabaseSync, backup } from 'node:sqlite';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const apply = process.argv.includes('--apply');
const ids = ['CLI-CN-049', 'CLI-CN-051', 'CLI-CN-053'];
const bankPath = 'data/scenarios/benchmark.json', metaPath = 'data/scenarios/benchmark-meta.json';
const bankText = fs.readFileSync(bankPath, 'utf8'), metaText = fs.readFileSync(metaPath, 'utf8');
const bank = JSON.parse(bankText), meta = JSON.parse(metaText);
const db = new DatabaseSync('apps/data/zxbench.db', { readOnly: !apply });
const reportPath = 'data/execution/retirement-evidence.json';
const active = () => db.prepare("SELECT count(*) n FROM EvalRun WHERE status IN ('running','pending','queued')").get().n;
try {
  if (ids.every(id => bank.find(s => s.id === id)?.status === 'retired')) {
    if (ids.some(id => db.prepare('SELECT status FROM ScenarioDefinition WHERE id=?').get(id)?.status !== 'retired')) throw Error('Bank/DB retirement drift');
    console.log('Already retired; no changes'); process.exit(0);
  }
  const runs = db.prepare("SELECT r.id,r.modelConfigId,r.createdAt,count(s.id) n FROM EvalRun r JOIN ScenarioResult s ON s.evalRunId=r.id WHERE r.status='completed' GROUP BY r.id HAVING n>=700 ORDER BY r.createdAt DESC").all();
  const seen = new Set();
  const selected = runs.filter(r => !seen.has(r.modelConfigId) && seen.add(r.modelConfigId)).slice(0, 7);
  if (selected.length !== 7) throw Error('Seven existing completed model runs required');
  const entries = ids.map(id => {
    const source = bank.find(s => s.id === id);
    const stored = db.prepare('SELECT scenarioHash,status FROM ScenarioDefinition WHERE id=?').get(id);
    if (!source || source.status !== 'valid' || stored?.status !== 'valid'
      || stored.scenarioHash !== source.scenarioHash) throw Error(`Source drift: ${id}`);
    const rows = selected.map(run => {
      const r = db.prepare('SELECT scenarioVersion,graderVersion,totalScore,environmentError,outputMetadata FROM ScenarioResult WHERE evalRunId=? AND scenarioId=?').get(run.id, id);
      const metadata = JSON.parse(r?.outputMetadata ?? '{}');
      if (!r || r.totalScore !== 100 || r.environmentError || metadata.truncated
        || metadata.evaluationAudit?.scenarioHash !== source.scenarioHash
        || r.scenarioVersion !== source.scenarioVersion) throw Error(`Insufficient comparable evidence: ${id}/${run.id}`);
      return { runId: run.id, modelId: run.modelConfigId, scenarioVersion: r.scenarioVersion,
        scenarioHash: source.scenarioHash, graderVersion: r.graderVersion, score: r.totalScore };
    });
    if (new Set(rows.map(r => r.graderVersion)).size !== 1) throw Error(`Grader mismatch: ${id}`);
    return { id, decision: 'retire_legacy_basic_item', reason: 'Seven comparable existing runs all score 100; elementary task retained as Docker regression.',
      limitation: 'Legacy scoring saturation, not proof of universal execution-task saturation or seven independent model families.', rows };
  });
  if (!apply) { console.log(JSON.stringify({ dryRun: true, entries }, null, 2)); process.exit(0); }
  if (active()) throw Error('An evaluation is active; do not change its task selection');
  const dir = `logs/cli-retirement-${Date.now()}`;
  fs.mkdirSync(dir, { recursive: true });
  await backup(db, `${dir}/before.sqlite`);
  fs.writeFileSync(`${dir}/benchmark.json`, bankText); fs.writeFileSync(`${dir}/benchmark-meta.json`, metaText);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (active() || fs.readFileSync(bankPath, 'utf8') !== bankText || fs.readFileSync(metaPath, 'utf8') !== metaText) throw Error('Concurrent publication or active run');
    for (const id of ids) {
      const s = bank.find(s => s.id === id); s.status = 'retired'; s.scenarioHash = hashScenarioShort(s);
      const result = db.prepare("UPDATE ScenarioDefinition SET status='retired',scenarioHash=?,updatedAt=? WHERE id=? AND scenarioHash=? AND status='valid'")
        .run(s.scenarioHash, Date.now(), id, entries.find(e => e.id === id).rows[0].scenarioHash);
      if (result.changes !== 1) throw Error(`Concurrent definition edit: ${id}`);
    }
    const version = meta.version.split('.').map(Number); version[1]++; version[2] = 0; meta.version = version.join('.');
    meta.count -= ids.length; meta.validCount -= ids.length; meta.retiredCount += ids.length;
    meta.dimensions.cli_deep_tasks -= ids.length;
    meta.retiredDimensions.cli_deep_tasks = (meta.retiredDimensions.cli_deep_tasks ?? 0) + ids.length;
    meta.generatedAt = new Date().toISOString();
    meta.executionCuration = { retiredIds: ids, reason: 'legacy_basic_score_saturation', evidence: reportPath, historyPreserved: true };
    fs.mkdirSync('data/execution', { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({ version: meta.version, createdAt: meta.generatedAt, backup: dir, entries }, null, 2) + '\n');
    fs.writeFileSync(bankPath, JSON.stringify(bank, null, 1) + '\n');
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 1) + '\n');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK'); fs.writeFileSync(bankPath, bankText); fs.writeFileSync(metaPath, metaText); throw error;
  }
  console.log(JSON.stringify({ retired: ids, version: meta.version, activeCount: meta.count, backup: dir }));
} finally { db.close(); }
