// Minimal judge admission: every witness and one wrong-token response per source.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {structuredContractV2Evaluator} from '../packages/core/dist/index.js';
const root = `data/pilots/structured-contract-escape-${process.argv.includes('--v3') ? 'v3' : process.argv.includes('--v2') ? 'v2' : 'v1'}`;
const read = name => JSON.parse(fs.readFileSync(`${root}/${name}.json`, 'utf8'));
const sha = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const manifest = read('manifest'), development = read('development'), holdout = read('holdout'), gold = read('gold.private');
for (const [key, value] of Object.entries({development, holdout, gold}))
  if (sha(value) !== manifest.hashes[key]) throw Error(`${key} changed after freeze`);
if (development.length !== manifest.counts.development || holdout.length !== manifest.counts.holdout)
  throw Error('Pack counts changed');
let positive = 0, negative = 0;
for (const scenario of [...development, ...holdout]) {
  const witness = gold.find(x => x.id === scenario.id);
  if (!witness) throw Error(`Missing witness ${scenario.id}`);
  const correct = await structuredContractV2Evaluator.evaluate(scenario, witness.raw, {});
  if (correct.environmentError || correct.totalScore !== 100) throw Error(`Witness rejected ${scenario.id}: ${JSON.stringify(correct.evidence)}`);
  positive++;
  const wrong = JSON.parse(witness.raw);
  const key = scenario.requirements.assertions[0].pointer.slice(1);
  wrong[key] += 'x';
  const incorrect = await structuredContractV2Evaluator.evaluate(scenario, JSON.stringify(wrong), {});
  if (incorrect.environmentError || incorrect.totalScore !== 0 || incorrect.structuredContractMetrics?.contentValid !== false)
    throw Error(`Wrong token accepted ${scenario.id}`);
  negative++;
}
const report = {status: 'passed', counts: {positive, negative}, hashes: manifest.hashes,
  checkedAt: new Date().toISOString(), scope: 'Frozen witnesses and one wrong token per scenario. No model calls.'};
fs.writeFileSync(`${root}/local-gate.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
