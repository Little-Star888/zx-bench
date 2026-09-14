import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { snapshotHash } from '../contracts/pack.js';
import { screenStructuralRuns } from '../evaluationLab/structuralChallenge/screen.js';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const [packDir, target, ...submissionPaths] = process.argv.slice(2);
if (!packDir || !target || !submissionPaths.length) throw new Error('Usage: screen-structural PACK_DIR NEW_RESULT SUBMISSION...');
const read = (p: string) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const manifest = read(resolve(root, packDir, 'manifest.json'));
for (const [path, hash] of Object.entries(manifest.codeFiles)) {
  if (createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') !== hash) throw new Error('Frozen source mismatch');
}
const pack = read(resolve(root, packDir, 'coordinator/frozen-pack.json')), inputs = submissionPaths.map(read);
const result = { ...screenStructuralRuns(pack, inputs), sourceSubmissions: submissionPaths.map((p, i) => ({ path: resolve(root, p), hash: snapshotHash(inputs[i]) })) };
writeFileSync(resolve(root, target), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ result: resolve(root, target), families: result.families.map(f => ({ family: f.family, signal: f.signal, spread: f.spread })) }));
