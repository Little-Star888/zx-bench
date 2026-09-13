// Freeze/check the automatic SQL evidence task. Human gold is intentionally not required.
// Default is read-only verification. Use --write after reviewing source changes.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PR_SQL_DEVELOPMENT_TASK } from '../packages/core/dist/evaluationLab/prWitnessSql.js';
const root = new URL('../', import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');
const sources = [
  'packages/core/src/evaluationLab/prWitnessSql.ts',
  'packages/core/src/evaluationLab/prWitnessSql.test.ts',
  'packages/core/src/execution/containerRunner.ts',
  'packages/core/src/execution/execAsync.ts',
];
const artifact = {
  version: 'pr-executable-evidence-1.0.0',
  status: 'production', registeredGrader: true, independentHumanGold: false,
  oldFreeReviewUnchanged: false, historicalRescoring: false,
  sourceHashNormalization: 'UTF-8, CRLF to LF',
  sourceHashes: Object.fromEntries(sources.map(path => [path, hash(readFileSync(new URL(path, root), 'utf8').replaceAll('\r\n', '\n'))])),
  taskHash: hash(JSON.stringify(PR_SQL_DEVELOPMENT_TASK)),
  task: PR_SQL_DEVELOPMENT_TASK,
};
const destination = new URL('data/scenarios/pr-witness-development.json', root);
const serialized = JSON.stringify(artifact, null, 2) + '\n';
if (process.argv.includes('--write')) writeFileSync(destination, serialized);
else if (readFileSync(destination, 'utf8').replaceAll('\r\n', '\n') !== serialized) throw Error('Development task freeze differs from current source; review before --write');
console.log(JSON.stringify({checked: true, written: process.argv.includes('--write'), id: artifact.task.id, taskHash: artifact.taskHash, status: artifact.status, registeredGrader: true, independentHumanGold: false}));
