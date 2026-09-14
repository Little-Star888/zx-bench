/** Bounded pilot on the already-loaded local baseline. Does not load/switch models. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotHash } from '../contracts/pack.js';
import { assertStructuralPack, scoreStructuralSubmission, type StructuralSubmission } from '../evaluationLab/structuralChallenge/index.js';
import { apiControlStream } from '../evaluationLab/apiControlStream.js';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const [mode, packArg, runArg] = process.argv.slice(2);
if (!['prepare', 'run'].includes(mode) || !packArg || !runArg) throw new Error('Usage: run-structural-local prepare|run PACK_DIR RUN_DIR');
const packDir = resolve(root, packArg), dir = resolve(root, runArg);
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const save = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
const pack = read(join(packDir, 'coordinator/frozen-pack.json')), manifest = read(join(packDir, 'manifest.json'));
const scriptHash = () => createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
function verify() {
  assertStructuralPack(pack);
  if (snapshotHash(pack) !== snapshotHash(read(join(packDir, 'coordinator/frozen-pack.json')))) throw new Error('Pack changed');
  for (const [path, hash] of Object.entries(manifest.codeFiles)) if (createHash('sha256').update(readFileSync(join(root, path))).digest('hex') !== hash) throw new Error('Frozen source mismatch');
  const db = new DatabaseSync(join(root, 'apps/data/zxbench.db'), { readOnly: true });
  try {
    const m = db.prepare('SELECT name,baseUrl FROM ModelConfig WHERE id=?').get('086461bc-49c6-4bd6-b4b8-f8260be0f71f');
    if (m?.name !== 'qwen3.8-27b-nvfp4' || m.baseUrl !== 'http://127.0.0.1:8081/v1') throw new Error('Local baseline configuration changed');
    if (db.prepare("SELECT id FROM EvalRun WHERE status='running' LIMIT 1").get()) throw new Error('Formal evaluation is active');
  } finally { db.close(); }
}
const plan = { packDir, contractHash: pack.contractHash, model: 'qwen3.8-27b-nvfp4', modelFamily: 'Qwen3.8',
  endpoint: 'http://127.0.0.1:8081/v1/chat/completions', parameters: { temperature: 0.6, top_p: 0.95 },
  maxTokens: 32768, hardSeconds: 300, concurrency: 1, automaticRetries: 0, judgeCalls: 0, tools: false,
  productionWrites: false, modelSwitches: 0, scriptHash: scriptHash(), packCodeHash: manifest.codeHash,
  budgetScope: 'local diagnostic budget; not directly comparable to earlier 600-second production runs' };
verify();
if (mode === 'prepare') {
  if (existsSync(dir)) throw new Error('New directory required'); mkdirSync(dir, { recursive: true }); save(join(dir, 'plan.json'), plan);
  console.log(JSON.stringify({ prepared: dir, planned: pack.questions.length, model: plan.model }));
} else {
  if (snapshotHash(read(join(dir, 'plan.json'))) !== snapshotHash(plan)) throw new Error('Changed run plan');
  if (existsSync(join(dir, 'STOP'))) throw new Error('Stopped');
  const response = await fetch('http://127.0.0.1:8081/v1/models', { signal: AbortSignal.timeout(5000), redirect: 'error' });
  const models = await response.json() as { data?: { id: string }[] };
  if (!response.ok || models.data?.length !== 1 || models.data[0].id !== plan.model) throw new Error('Expected baseline is not loaded');
  save(join(dir, 'RUN_STARTED.json'), { startedAt: new Date().toISOString(), pid: process.pid });
  const input: StructuralSubmission = { contractHash: pack.contractHash, runId: dir, modelId: plan.model, modelFamily: plan.modelFamily, answers: [] };
  const status = (v: object) => { writeFileSync(join(dir, 'status.json.tmp'), JSON.stringify({ ...v, updatedAt: new Date().toISOString() }, null, 2)); renameSync(join(dir, 'status.json.tmp'), join(dir, 'status.json')); };
  try {
    for (const question of pack.questions) {
      verify(); if (existsSync(join(dir, 'STOP'))) break;
      const item = join(dir, question.id); mkdirSync(item);
      const body = { model: plan.model, messages: question.messages, ...plan.parameters, max_tokens: plan.maxTokens, stream: true };
      save(join(item, 'request.json'), { endpoint: plan.endpoint, body, questionHash: question.questionHash });
      const active = { state: 'running', completed: input.answers.length, planned: pack.questions.length, question: question.id };
      status(active); console.log(JSON.stringify(active)); let last = 0;
      const raw = await apiControlStream({ endpoint: plan.endpoint, key: '', body, wireFile: join(item, 'wire.sse'), stopFile: join(dir, 'STOP'), timeoutMs: plan.hardSeconds * 1000,
        onProgress: progress => { if (Date.now() - last >= 5000) { last = Date.now(); status({ ...active, progress }); } } });
      save(join(item, 'raw.json'), raw);
      const error = raw.error ?? (raw.returnedModels.length && raw.returnedModels.every(m => m === plan.model) ? null : 'unexpected_returned_model');
      const outcome = existsSync(join(dir, 'STOP')) ? 'environment_error' : error === 'timeout_or_cancelled' ? 'timeout' : error === 'truncated' ? 'truncated' : error ? 'environment_error' : 'completed';
      input.answers.push({ id: question.id, questionHash: question.questionHash, outcome, output: raw.content });
      const scored = scoreStructuralSubmission(pack, input), row = scored.rows.find(r => r.id === question.id)!;
      save(join(item, 'grade.json'), row); save(join(dir, `submission-${String(input.answers.length).padStart(3, '0')}.json`), input);
      console.log(JSON.stringify({ question: question.id, outcome, pass: row.contentPass, score: row.contentScore, milliseconds: raw.latencyMs }));
      if (outcome === 'environment_error') break;
    }
  } finally {
    save(join(dir, 'submission.json'), input);
    const scored = { ...scoreStructuralSubmission(pack, input), conditions: plan, submissionHash: snapshotHash(input) };
    save(join(dir, 'scored.json'), scored); status({ state: input.answers.length === pack.questions.length && input.answers.every(a => a.outcome !== 'environment_error') ? 'completed' : 'incomplete', recorded: input.answers.length, planned: pack.questions.length, dimensions: scored.dimensions });
    console.log(JSON.stringify({ recorded: input.answers.length, dimensions: scored.dimensions }));
  }
}
