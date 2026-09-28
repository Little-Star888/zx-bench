import fs from 'node:fs';
import path from 'node:path';
import { taskContract } from './lib/execution-task-pack.mjs';
import { sourceHashes } from './lib/execution-source-hashes.mjs';
import { references, counterexamples } from './check-cli-original-docker.mjs';
import { advancedCliTasks } from './lib/advanced-cli-tasks.mjs';
import { recoveryWorldTasks } from './lib/recovery-world-tasks.mjs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';
import { validateScenario } from '../packages/core/dist/contracts/validateScenario.js';

const root = 'data/execution';
const tasks = ['cli-original-docker-v1', 'cli-advanced-docker-v1', 'recovery-world-docker-v1'].flatMap(name =>
  JSON.parse(fs.readFileSync(`data/pilots/${name}.json`, 'utf8')));
for (const task of advancedCliTasks) {
  references[task.sourceId] = task.reference;
  counterexamples[task.sourceId] = task.counterexample;
}
const hashes = sourceHashes();
const regression = new Set(['CLI-CN-049', 'CLI-CN-050', 'CLI-CN-051', 'CLI-CN-053', 'CLI-CN-056']);
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const entries = [];
for (const scenario of tasks) {
  if (scenario.scenarioHash !== hashScenarioShort(scenario) || validateScenario(scenario).errors.length) {
    throw Error(`Invalid source contract: ${scenario.id}`);
  }
  const sourceId = scenario.requirements.migrationSourceId;
  const worldFixture = recoveryWorldTasks.find(task => scenario.id === `${task.sourceId}-RECOVERY-${task.variant}`);
  if (!worldFixture && (!references[sourceId] || !counterexamples[sourceId])) throw Error(`Missing witnesses: ${sourceId}`);
  const dir = path.join(root, 'tasks', scenario.id);
  fs.mkdirSync(path.join(dir, 'solution'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  const contract = taskContract(scenario, hashes.runtime, hashes.verifier);
  const manifest = { schemaVersion: 1, format: 'zxbench-execution-task-v1', id: scenario.id, sourceId,
    scenarioVersion: scenario.scenarioVersion, scenarioHash: scenario.scenarioHash,
    track: regression.has(sourceId) ? 'regression' : 'development',
    readiness: 'reference_witnesses_available_model_calibration_pending', contract,
    environment: { image: scenario.requirements.executionWorld?.image ?? scenario.requirements.executionImage,
      imageId: scenario.requirements.executionWorld?.expectedImageId ?? scenario.requirements.executionImageId,
      network: 'none', workspaceMb: 64, timeoutMs: 60000 },
    inputCases: scenario.requirements.executionCases?.length ?? 1,
    reference: worldFixture ? 'solution/trace.json' : 'solution/solve.sh',
    counterexample: worldFixture ? 'tests/counterexample.json' : 'tests/counterexample.sh',
    runner: `node scripts/${worldFixture ? 'check-recovery-world-docker' : 'check-execution-task-pack'}.mjs --task=` + scenario.id };
  write(path.join(dir, 'manifest.json'), manifest);
  write(path.join(dir, 'scenario.json'), scenario);
  fs.writeFileSync(path.join(dir, 'instruction.md'), `${scenario.promptTemplate}\n`);
  if (worldFixture) {
    write(path.join(dir, 'solution/trace.json'), worldFixture.reference);
    write(path.join(dir, 'tests/counterexample.json'), worldFixture.counterexample);
  } else {
    fs.writeFileSync(path.join(dir, 'solution/solve.sh'), `${references[sourceId]}\n`);
    fs.writeFileSync(path.join(dir, 'tests/counterexample.sh'), `${counterexamples[sourceId]}\n`);
  }
  entries.push({ id: scenario.id, sourceId, track: manifest.track, manifest: `tasks/${scenario.id}/manifest.json`, contract });
}
write(path.join(root, 'registry.json'), { schemaVersion: 1, tasks: entries,
  note: 'Native zxbench task packs; not a Harbor compatibility claim. Only development/regression, no automatic promotion.' });
console.log(JSON.stringify({ packaged: entries.length, regression: entries.filter(x => x.track === 'regression').length,
  development: entries.filter(x => x.track === 'development').length }));
