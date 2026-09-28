// Read-only coverage inventory. This is a triage signal, not a claim of full semantic coverage.
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const bank = JSON.parse(readFileSync('data/scenarios/benchmark.json', 'utf8'))
  .filter(s => s.dimension === 'structured_output');
const db = new DatabaseSync('apps/data/zxbench.db', { readOnly: true });
const recent = db.prepare(`SELECT id FROM EvalRun WHERE status='completed'
  AND id IN (SELECT evalRunId FROM ScenarioResult WHERE dimension='structured_output')
  ORDER BY createdAt DESC LIMIT 6`).all().map(r => r.id);
const history = db.prepare(`SELECT totalScore FROM ScenarioResult WHERE scenarioId=? AND evalRunId=?`);
const rows = bank.map(s => {
  const scores = recent.map(id => history.get(s.id, id)?.totalScore).filter(Number.isFinite);
  const constraints = s.requirements?.constraints?.length ?? 0;
  const schema = Boolean(s.requirements?.schema);
  return { id: s.id, status: s.status, format: s.requirements?.format,
    fields: s.requirements?.requiredFields?.length ?? 0, constraints, schema,
    samples: scores.length, perfect: scores.filter(x => x >= 99.5).length,
    priority: s.status !== 'valid' ? 'retired' : !constraints && !schema ? 'contract-gap'
      : scores.length >= 4 && scores.every(x => x >= 99.5) ? 'ceiling-audit' : 'review' };
});
const counts = Object.fromEntries([...new Set(rows.map(r => r.priority))].map(k => [k, rows.filter(r => r.priority === k).length]));
const out = { generatedAt: new Date().toISOString(), runIds: recent, counts, rows };
writeFileSync('data/pilots/structured-output-coverage-audit.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(counts));
db.close();
