// Recompute frozen scenario hashes after a deliberate canonicalization change.
// This only changes `scenarioHash`; it never edits prompts, gold answers or
// historical run rows.  Follow with sync-reviewed-question-contracts.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const bankPath = new URL('../data/scenarios/benchmark.json', import.meta.url);
const scenarios = JSON.parse(readFileSync(bankPath, 'utf8'));
const changed = [];
for (const scenario of scenarios) {
  const next = hashScenarioShort(scenario);
  if (scenario.scenarioHash !== next) {
    changed.push({ id: scenario.id, from: scenario.scenarioHash, to: next });
    scenario.scenarioHash = next;
  }
}
writeFileSync(bankPath, `${JSON.stringify(scenarios, null, 1)}\n`);
console.log(JSON.stringify({ total: scenarios.length, changed: changed.length, changed }, null, 2));
