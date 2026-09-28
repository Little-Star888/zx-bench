import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { structuredOutputEvaluator } from '../packages/core/dist/evaluators/structuredOutput.js';
const oldBank = new Map(JSON.parse(readFileSync('data/scenarios/benchmark.json', 'utf8')).map(s => [s.id, s]));
const nextBank = JSON.parse(readFileSync('data/pilots/structured-output-contract-repair.json', 'utf8'));
const db = new DatabaseSync('apps/data/zxbench.db', { readOnly: true });
const rows = db.prepare(`SELECT r.evalRunId, r.scenarioId, r.modelOutput FROM ScenarioResult r
  JOIN EvalRun e ON e.id=r.evalRunId WHERE e.status='completed' AND r.scenarioId=?
  AND r.modelOutput IS NOT NULL AND length(r.modelOutput)>0 ORDER BY e.createdAt DESC LIMIT 6`);
for (const scenario of nextBank) {
  const results = [];
  for (const row of rows.all(scenario.id)) {
    const old = await structuredOutputEvaluator.evaluate(oldBank.get(scenario.id), row.modelOutput, {}, {});
    const next = await structuredOutputEvaluator.evaluate(scenario, row.modelOutput, {}, {});
    const failed = next.criterionResults.filter(x => x.status === 'fail' &&
      !old.criterionResults.some(previous => previous.description === x.description && previous.status === 'fail'))
      .map(x => x.description);
    results.push({ run: row.evalRunId.slice(-8), old: old.totalScore, next: next.totalScore, addedFailures: failed });
  }
  console.log(JSON.stringify({ id: scenario.id, results }));
}
db.close();
