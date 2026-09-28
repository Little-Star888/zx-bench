import fs from 'node:fs';
import { cliCommandEvaluator, validateScenario } from '../packages/core/dist/index.js';
import { digest, taskContract, reuseDecision, strictSuccess } from './lib/execution-task-pack.mjs';
import { sourceHashes } from './lib/execution-source-hashes.mjs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const registry = JSON.parse(fs.readFileSync('data/execution/registry.json', 'utf8'));
const only = process.argv.find(a => a.startsWith('--task='))?.slice(7);
if (only && !registry.tasks.some(t => t.id === only)) throw Error('Unknown task');
const hashes = sourceHashes();
const meta = { finishReason: 'stop', truncated: false, containsCodeBlock: false,
  containsFinalConclusion: true, outputLength: 1, outputTokens: 1, inputTokens: 1,
  maxTokens: 100, incomplete: false };
for (const entry of registry.tasks) {
  if (only && entry.id !== only) continue;
  const dir = `data/execution/tasks/${entry.id}`;
  const scenario = JSON.parse(fs.readFileSync(`${dir}/scenario.json`, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, 'utf8'));
  if (scenario.requirements.executionWorld) {
    console.log(`${entry.id}: use ${manifest.runner}`); continue;
  }
  if (validateScenario(scenario).errors.length || scenario.id !== entry.id
    || scenario.scenarioHash !== manifest.scenarioHash || scenario.scenarioHash !== hashScenarioShort(scenario)) {
    throw Error(`Invalid task: ${entry.id}`);
  }
  const contract = taskContract(scenario, hashes.runtime, hashes.verifier);
  const good = fs.readFileSync(`${dir}/solution/solve.sh`, 'utf8');
  const bad = fs.readFileSync(`${dir}/tests/counterexample.sh`, 'utf8');
  const witnessHash = digest({ good, bad });
  const reportPath = `${dir}/tests/reference-report.json`;
  const previous = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
  const reusable = previous?.passed && previous.witnessHash === witnessHash
    && reuseDecision(previous.contract, contract) === 'reuse';
  if (process.argv.includes('--plan-only')) {
    console.log(`${entry.id}: ${reusable ? 'reuse' : 'reference verification required'}`); continue;
  }
  if (!process.argv.includes('--force') && reusable) {
    console.log(`${entry.id}: reused matching reference evidence`); continue;
  }
  const positive = await cliCommandEvaluator.evaluate(scenario, good, { ...meta });
  const negative = await cliCommandEvaluator.evaluate({ ...scenario, requirements: { ...scenario.requirements,
    executionCases: scenario.requirements.executionCases.slice(0, 1) } }, bad, { ...meta });
  const passed = strictSuccess(positive) && !strictSuccess(negative) && !negative.environmentError;
  fs.writeFileSync(reportPath, JSON.stringify({ checkedAt: new Date().toISOString(), contract,
    witnessHash, passed, positiveScore: positive.totalScore, negativeScore: negative.totalScore,
    positiveEvidence: positive.evidence, negativeEvidence: negative.evidence }, null, 2) + '\n');
  if (!passed) throw Error(`Reference gate failed: ${entry.id}`);
  console.log(`${entry.id}: reference 100, counterexample ${negative.totalScore}`);
}
