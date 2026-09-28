// Re-score existing completed answers without running a model or changing historical scores.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { structuredOutputEvaluator } from '../packages/core/dist/evaluators/structuredOutput.js';

const releases = readdirSync('logs').filter(name => name.startsWith('structured-output-contract-repair-v2-'))
  .sort().reverse();
const baselinePath = releases.length && existsSync(`logs/${releases[0]}/benchmark.json`)
  ? `logs/${releases[0]}/benchmark.json` : 'data/scenarios/benchmark.json';
const oldBank = new Map(JSON.parse(readFileSync(baselinePath, 'utf8')).map(s => [s.id, s]));
const candidates = JSON.parse(readFileSync('data/pilots/structured-output-contract-repair-v2.json', 'utf8'));
const db = new DatabaseSync('apps/data/zxbench.db', { readOnly: true });
const query = db.prepare(`SELECT r.evalRunId, r.modelOutput FROM ScenarioResult r JOIN EvalRun e ON e.id=r.evalRunId
  WHERE e.status='completed' AND r.scenarioId=? AND r.modelOutput IS NOT NULL
  AND length(r.modelOutput)>0 ORDER BY e.createdAt DESC LIMIT 6`);
const report = [];
for (const candidate of candidates) {
  const rows = [];
  for (const row of query.all(candidate.id)) {
    const old = await structuredOutputEvaluator.evaluate(oldBank.get(candidate.id), row.modelOutput, {}, {});
    const next = await structuredOutputEvaluator.evaluate(candidate, row.modelOutput, {}, {});
    rows.push({ runId: row.evalRunId, before: old.totalScore, after: next.totalScore,
      newFailures: next.criterionResults.filter(item => item.status === 'fail' &&
        !old.criterionResults.some(previous => previous.description === item.description && previous.status === 'fail'))
        .map(item => item.description) });
  }
  report.push({ id: candidate.id, rows });
}
db.close();
writeFileSync('data/pilots/structured-output-contract-repair-v2-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.map(item => ({ id: item.id, scores: item.rows.map(row => [row.before,row.after]),
  newFailureCount: item.rows.reduce((count, row) => count + row.newFailures.length, 0) }))));
