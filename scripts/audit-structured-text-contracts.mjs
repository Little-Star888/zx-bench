import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { structuredOutputEvaluator } from '../packages/core/dist/evaluators/structuredOutput.js';

const releases = readdirSync('logs').filter(name => name.startsWith('structured-text-contracts-')).sort().reverse();
const basePath = releases.length && existsSync(`logs/${releases[0]}/benchmark.json`)
  ? `logs/${releases[0]}/benchmark.json` : 'data/scenarios/benchmark.json';
const before = new Map(JSON.parse(readFileSync(basePath, 'utf8')).map(s => [s.id,s]));
const candidates = JSON.parse(readFileSync('data/pilots/structured-text-contracts.json', 'utf8'));
const db = new DatabaseSync('apps/data/zxbench.db', { readOnly: true });
const query = db.prepare(`SELECT r.evalRunId,r.modelOutput FROM ScenarioResult r JOIN EvalRun e ON e.id=r.evalRunId
 WHERE e.status='completed' AND r.scenarioId=? AND r.modelOutput IS NOT NULL AND length(r.modelOutput)>0
 ORDER BY e.createdAt DESC LIMIT 6`);
const report = [];
for (const scenario of candidates) {
  const rows = [];
  for (const row of query.all(scenario.id)) {
    const old = await structuredOutputEvaluator.evaluate(before.get(scenario.id), row.modelOutput, {}, {});
    const next = await structuredOutputEvaluator.evaluate(scenario, row.modelOutput, {}, {});
    rows.push({ runId: row.evalRunId, before: old.totalScore, after: next.totalScore,
      newFailures: next.criterionResults.filter(item => item.status === 'fail' &&
        !old.criterionResults.some(previous => previous.description === item.description && previous.status === 'fail'))
        .map(item => item.description) });
  }
  report.push({ id: scenario.id, rows });
}
db.close();
writeFileSync('data/pilots/structured-text-contracts-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.map(item => ({ id: item.id,
  scorePairs: item.rows.map(row => [row.before,row.after]),
  failures: Object.entries(item.rows.flatMap(row => row.newFailures).reduce((map,label) =>
    ({ ...map,[label]:(map[label] ?? 0)+1 }), {})).sort((a,b) => b[1]-a[1]).slice(0,5) }))));
