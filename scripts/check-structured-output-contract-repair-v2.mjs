// One adversarial mutation per repaired question. Reuses stored answers; no model calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { structuredOutputEvaluator } from '../packages/core/dist/evaluators/structuredOutput.js';

const candidates = JSON.parse(readFileSync('data/pilots/structured-output-contract-repair-v2.json', 'utf8'));
const db = new DatabaseSync('apps/data/zxbench.db', { readOnly: true });
const query = db.prepare(`SELECT r.modelOutput FROM ScenarioResult r JOIN EvalRun e ON e.id=r.evalRunId
  WHERE e.status='completed' AND r.scenarioId=? AND r.modelOutput IS NOT NULL
  ORDER BY e.createdAt DESC LIMIT 6`);
const changes = {
  '003': value => { value.items[0].subtotal += 10; },
  '006': value => { value.data.user.id = 'not-a-uuid'; },
  '009': value => { value.rows = value.rows; },
  '028': value => { value.patterns.find(item => /手机|电话/.test(item.name)).regex = '^1\\d{9}$'; },
  '029': value => { delete value.dependencies[Object.keys(value.dependencies)[0]]; },
  '030': value => { delete value.environments.staging.healthCheck; },
  '040': value => { value.runNumber = 1286; },
  '044': value => { value.schema.properties.quantity.minimum = -1; },
  '046': value => { value.ledger[29].month = '2028-06'; },
  '048': value => { value.items[0].code = 'ITEM-9999'; },
  '050': value => { value.transactions[0].net += 1; },
  '051': value => { value.months[7].departments[3].remaining += 1; },
  '058': value => { value.items[0].status = 'unknown'; },
  '059': value => { [value.notes[0].id, value.notes[1].id] = [value.notes[1].id, value.notes[0].id]; },
};
const results = [];
for (const scenario of candidates) {
  const suffix = scenario.id.slice(-3);
  let baseOutput;
  for (const row of query.all(scenario.id)) {
    const score = await structuredOutputEvaluator.evaluate(scenario, row.modelOutput, {}, {});
    if (score.totalScore === 100) { baseOutput = row.modelOutput; break; }
  }
  assert(baseOutput, `No valid baseline for ${scenario.id}`);
  let mutated;
  if (suffix === '007') mutated = baseOutput.replace('465655', '435655');
  else if (suffix === '009') mutated = baseOutput.replace(/,\d{4,5},(?=\d{11}(?:\r?\n|$))/, ',40000,');
  else {
    const parsed = JSON.parse(baseOutput);
    changes[suffix](parsed);
    mutated = JSON.stringify(parsed);
  }
  assert.notEqual(mutated, baseOutput, `Mutation did not alter ${scenario.id}`);
  const result = await structuredOutputEvaluator.evaluate(scenario, mutated, {}, {});
  assert(result.totalScore < 100, `Mutation escaped ${scenario.id}`);
  results.push({ id: scenario.id, mutatedScore: result.totalScore });
}
db.close();
console.log(JSON.stringify(results));
