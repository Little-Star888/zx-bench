import { readFileSync } from 'node:fs';
import { lightweightDiscriminationGate } from '../packages/core/dist/evaluationLab/observedDiscrimination.js';

const args = process.argv.slice(2);
const inputPath = args.find(arg => !arg.startsWith('--'));
if (!inputPath) {
  console.error('Usage: pnpm screen:discrimination -- <results.json> [--gate]');
  console.error('Input: {"dimension":"reasoning_math","models":[{"modelId":"...","modelFamily":"...","executionClass":"local_unsloth|provider_api","rows":[{"id":"...","family":"...","pass":true,"state":"completed"}]}]}');
  process.exit(2);
}
const input = JSON.parse(readFileSync(inputPath, 'utf8'));
const report = lightweightDiscriminationGate(input.dimension, input.models, input.policy);
console.log(JSON.stringify(report, null, 2));
if (args.includes('--gate') && !report.readyForMaintainerFreeze) process.exitCode = 1;
