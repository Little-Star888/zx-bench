// Refresh the existing execution audit after the bounded PR evidence migration.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const manifestPath = new URL('../data/scenarios/execution-review-manifest.json', import.meta.url);
const bankPath = new URL('../data/scenarios/benchmark.json', import.meta.url);
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const bank = JSON.parse(readFileSync(bankPath, 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(new URL(path, root), 'utf8').replaceAll('\r\n', '\n')).digest('hex');

for (const path of Object.keys(manifest.sourceHashes)) manifest.sourceHashes[path] = hash(path);
for (const path of [
  'packages/core/src/evaluators/prExecutableEvidence.ts',
  'packages/core/src/evaluators/prExecutableEvidence.test.ts',
  'packages/core/src/evaluationLab/prWitnessSql.ts',
  'packages/core/src/evaluationLab/prWitnessSharding.ts',
  'packages/core/src/prExecutableOrchestrator.test.ts',
  'scripts/upgrade-pr-executable-evidence.mjs',
]) manifest.sourceHashes[path] = hash(path);
for (const id of ['PR-ELITE-012', 'PR-ELITE-013']) {
  const scenario = bank.find(s => s.id === id);
  const entry = manifest.scenarios.find(s => s.id === id);
  if (!scenario || !entry) throw new Error(`Missing manifest scenario ${id}`);
  Object.assign(entry, { grader: scenario.grader, graderVersion: scenario.graderVersion, scenarioHash: scenario.scenarioHash });
}
manifest.version = 'execution-review-2026-09-13-pr-executable-evidence-1.0';
manifest.prEvidence = { automaticOnly: true, judgeWeight: 0, humanReviewRequired: false,
  scenarios: ['PR-ELITE-012', 'PR-ELITE-013'] };
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Refreshed PR executable-evidence audit manifest');
