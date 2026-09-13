import { runDeepAdversarialAudit, probeContainerResultForgery } from '../packages/core/dist/evaluationLab/deepAdversarial.js';
import { readFileSync } from 'node:fs';
const bank = JSON.parse(readFileSync(new URL('../data/scenarios/benchmark.json', import.meta.url), 'utf8'));
const meta = JSON.parse(readFileSync(new URL('../data/scenarios/benchmark-meta.json', import.meta.url), 'utf8'));
const report = await runDeepAdversarialAudit(bank, meta);
if (process.argv.includes('--containers')) report.containerProbe = await probeContainerResultForgery();
console.log(JSON.stringify(report, null, 2));
// Explicit acceptance command fails while any boundary remains unresolved.
if (process.argv.includes('--gate') && !report.releaseReady) process.exitCode = 1;
