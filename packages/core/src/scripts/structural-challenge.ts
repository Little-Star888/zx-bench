/** Frozen, opt-in candidate evaluation. Never writes benchmark history or model configuration. */
import { createHash, createDecipheriv, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotHash } from '../contracts/pack.js';
import { buildStructuralChallenge, assertStructuralPack, scoreStructuralSubmission, type StructuralSubmission, type StructuralPack } from '../evaluationLab/structuralChallenge/index.js';
import { apiControlStream } from '../evaluationLab/apiControlStream.js';
import { API_CONTROL_PROVIDERS, allowedReturnedModel } from '../evaluationLab/apiControlPlan.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const [mode, ...args] = process.argv.slice(2);
const usage = `structural-challenge export NEW_PACK_DIR development|confirmation SEED INSTANCES(1..10)
  verify PACK_DIR
  grade PACK_DIR SUBMISSION NEW_RESULT
  prepare-run PACK_DIR NEW_RUN_DIR deepseek-v4-flash|glm-5.2 MAX_TOKENS HARD_SECONDS
  run RUN_DIR
Each run uses one attempt per item, a fresh context, no tools or Judge, and the stored provider configuration.`;
const read = (p: string) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const save = (p: string, data: unknown) => writeFileSync(resolve(root, p), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const sourceFiles = ['types.ts', 'math.ts', 'extraction.ts', 'evidence.ts', 'index.ts'].map(n => 'packages/core/src/evaluationLab/structuralChallenge/' + n)
  .concat(['packages/core/src/scripts/structural-challenge.ts', 'packages/core/src/contracts/pack.ts',
    ...['challengeTypes.ts', 'linearOptimizationCertificate.ts', 'methodsV2/types.ts', 'methodsV2/verify.ts', 'apiControlStream.ts', 'he001JudgeTrial.ts', 'apiControlPlan.ts'].map(n => 'packages/core/src/evaluationLab/' + n)]);
const codeFiles = () => Object.fromEntries(sourceFiles.map(p => [p, createHash('sha256').update(readFileSync(join(root, p))).digest('hex')]));
const codeHash = () => snapshotHash(codeFiles());
function verify(directory: string): StructuralPack {
  const dir = resolve(root, directory), pack = read(join(dir, 'coordinator/frozen-pack.json')) as StructuralPack;
  assertStructuralPack(pack);
  const manifest = read(join(dir, 'manifest.json')), publicPack = read(join(dir, 'candidate-questions.json'));
  if (manifest.codeHash !== codeHash() || snapshotHash(manifest.codeFiles) !== snapshotHash(codeFiles()) || manifest.contractHash !== pack.contractHash ||
      manifest.publicHash !== snapshotHash(publicPack) || snapshotHash(publicPack) !== snapshotHash({ contractHash: pack.contractHash, questions: pack.questions })) throw new Error('Frozen code/public pack mismatch');
  return pack;
}
type Provider = typeof API_CONTROL_PROVIDERS[number];
function configuration(provider: Provider) {
  const db = new DatabaseSync(join(root, 'apps/data/zxbench.db'), { readOnly: true });
  let row: { name: string; baseUrl: string; apiKey: string } | undefined;
  try { row = db.prepare('SELECT name,baseUrl,apiKey FROM ModelConfig WHERE id=?').get(provider.configId) as typeof row; } finally { db.close(); }
  if (!row || row.name !== provider.requestedModel || !row.apiKey) throw new Error('Stored provider configuration missing or changed');
  const endpoint = new URL(row.baseUrl.replace(/\/$/, '') + '/chat/completions');
  if (endpoint.href !== provider.endpoint || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Unexpected provider endpoint');
  return { endpoint: endpoint.href, encryptedKey: row.apiKey };
}
function decrypt(value: string) {
  if (!/^[a-f0-9]{32}:[a-f0-9]+$/i.test(value)) return value;
  const [iv, data] = value.split(':');
  const decipher = createDecipheriv('aes-256-cbc', scryptSync(process.env.ZXBENCH_ENCRYPTION_KEY || 'zxbench-default-key-change-me!', 'zxbench-salt', 32), Buffer.from(iv, 'hex'));
  return decipher.update(data, 'hex', 'utf8') + decipher.final('utf8');
}

if (!mode || ['--help', '-h'].includes(mode)) console.log(usage);
else if (mode === 'export' && args.length === 4) {
  const [target, split, seed, instances] = args;
  if (split !== 'development' && split !== 'confirmation') throw new Error(usage);
  const dir = resolve(root, target); if (existsSync(dir)) throw new Error('Export requires a new directory');
  const pack = buildStructuralChallenge({ seed: Number(seed), instances: Number(instances), split });
  const input: StructuralSubmission = { contractHash: pack.contractHash, runId: 'oracle-QA-NOT-model', modelId: 'reference', modelFamily: 'reference',
    answers: pack.cases.map(c => ({ id: c.id, questionHash: c.question.questionHash, outcome: 'completed', output: JSON.stringify(c.reference) })) };
  const qa = scoreStructuralSubmission(pack, input); if (qa.rows.some(r => !r.deliveredSuccess)) throw new Error('Oracle QA failed');
  mkdirSync(join(dir, 'coordinator'), { recursive: true });
  const publicPack = { contractHash: pack.contractHash, questions: pack.questions };
  save(join(dir, 'candidate-questions.json'), publicPack); save(join(dir, 'coordinator/frozen-pack.json'), pack);
  save(join(dir, 'coordinator/reference-QA-not-model.json'), { input, qa });
  save(join(dir, 'manifest.json'), { contractHash: pack.contractHash, publicHash: snapshotHash(publicPack), codeHash: codeHash(), codeFiles: codeFiles(),
    createdAt: new Date().toISOString(), options: pack.options, policy: pack.policy, questions: pack.cases.length, modelCalls: 0, judgeCalls: 0 });
  save(join(dir, 'submission-template.json'), { contractHash: pack.contractHash, runId: 'REPLACE', modelId: 'REPLACE', modelFamily: 'REPLACE_WITH_BASE_MODEL_FAMILY', answers: [] });
  writeFileSync(join(dir, '题面.md'), '# 结构变化候选题 · ' + split + '\n\n每题使用独立上下文。候选集，尚未校准难度。\n\n' +
    pack.questions.map(q => '## ' + q.id + '\n\n' + q.messages[0].content + '\n').join('\n'), { flag: 'wx' });
  console.log(JSON.stringify({ dir, questions: pack.cases.length, oracleChecks: qa.rows.length, modelCalls: 0 }));
} else if (mode === 'verify' && args.length === 1) {
  const pack = verify(args[0]); console.log(JSON.stringify({ verified: true, questions: pack.cases.length, contractHash: pack.contractHash }));
} else if (mode === 'grade' && args.length === 3) {
  const pack = verify(args[0]), input = read(args[1]), result = { ...scoreStructuralSubmission(pack, input), codeHash: codeHash(), submissionHash: snapshotHash(input) };
  save(args[2], result); console.log(JSON.stringify({ result: resolve(root, args[2]), dimensions: result.dimensions }));
} else if (mode === 'prepare-run' && args.length === 5) {
  const [packDir, target, providerKey, tokens, seconds] = args, pack = verify(packDir), provider = API_CONTROL_PROVIDERS.find(p => p.key === providerKey);
  const maxTokens = Number(tokens), hardSeconds = Number(seconds);
  if (!provider || !Number.isInteger(maxTokens) || maxTokens < 1024 || maxTokens > 90000 || !Number.isInteger(hardSeconds) || hardSeconds < 10 || hardSeconds > 1200) throw new Error('Invalid provider/budget');
  configuration(provider);
  const dir = resolve(root, target); if (existsSync(dir)) throw new Error('Run requires a new directory'); mkdirSync(dir, { recursive: true });
  const plan = { packDir: resolve(root, packDir), contractHash: pack.contractHash, provider, maxTokens, hardSeconds, concurrency: 1, automaticRetries: 0,
    requestedQuestions: pack.questions.length, freshContextPerQuestion: true, tools: false, judgeCalls: 0, productionWrites: false,
    budgetScope: 'provider-specific thinking; same token/time caps do not imply equal compute', codeHash: codeHash() };
  save(join(dir, 'plan.json'), plan); save(join(dir, 'plan-hash.json'), { hash: snapshotHash(plan) });
  console.log(JSON.stringify({ prepared: dir, questions: pack.questions.length, provider: provider.key, maxTokens, hardSeconds }));
} else if (mode === 'run' && args.length === 1) {
  const dir = resolve(root, args[0]), plan = read(join(dir, 'plan.json')), provider = API_CONTROL_PROVIDERS.find(p => p.key === plan.provider.key);
  const verifyRun = () => {
    if (snapshotHash(read(join(dir, 'plan.json'))) !== snapshotHash(plan) || snapshotHash(plan) !== read(join(dir, 'plan-hash.json')).hash ||
        plan.codeHash !== codeHash() || !provider || snapshotHash(provider) !== snapshotHash(plan.provider)) throw new Error('Frozen run plan mismatch');
    const p = verify(plan.packDir); if (p.contractHash !== plan.contractHash) throw new Error('Run pack mismatch'); return p;
  };
  const pack = verifyRun(), config = configuration(provider!), key = decrypt(config.encryptedKey);
  if (existsSync(join(dir, 'STOP'))) throw new Error('Run is stopped');
  save(join(dir, 'RUN_STARTED.json'), { startedAt: new Date().toISOString(), pid: process.pid }); // wx prevents retries
  const input: StructuralSubmission = { contractHash: pack.contractHash, runId: dir, modelId: provider!.requestedModel, modelFamily: provider!.family, answers: [] };
  const status = (value: object) => {
    writeFileSync(join(dir, 'status.json.tmp'), JSON.stringify({ ...value, updatedAt: new Date().toISOString() }, null, 2));
    renameSync(join(dir, 'status.json.tmp'), join(dir, 'status.json'));
  };
  try {
    for (const question of pack.questions) {
      verifyRun(); if (existsSync(join(dir, 'STOP'))) break;
      const itemDir = join(dir, question.id); mkdirSync(itemDir);
      const body = { model: provider!.requestedModel, messages: question.messages, ...provider!.parameters, max_tokens: plan.maxTokens, stream: true };
      save(join(itemDir, 'request.json'), { endpoint: config.endpoint, body, questionHash: question.questionHash });
      const active = { state: 'running', completed: input.answers.length, planned: pack.questions.length, question: question.id };
      status(active); console.log(JSON.stringify(active)); let last = 0;
      const raw = await apiControlStream({ endpoint: config.endpoint, key, body, wireFile: join(itemDir, 'wire.sse'), stopFile: join(dir, 'STOP'), timeoutMs: plan.hardSeconds * 1000,
        onProgress: progress => { if (Date.now() - last >= 5000) { last = Date.now(); status({ ...active, progress }); } } });
      save(join(itemDir, 'raw.json'), raw);
      const error = raw.error ?? (allowedReturnedModel(provider!.key, raw.returnedModels) ? null : 'unexpected_returned_model');
      const outcome = existsSync(join(dir, 'STOP')) ? 'environment_error' : error === 'timeout_or_cancelled' ? 'timeout' : error === 'truncated' ? 'truncated' : error ? 'environment_error' : 'completed';
      input.answers.push({ id: question.id, questionHash: question.questionHash, outcome, output: raw.content });
      const scored = scoreStructuralSubmission(pack, input), row = scored.rows.find(r => r.id === question.id)!;
      save(join(itemDir, 'grade.json'), row);
      save(join(dir, `submission-${String(input.answers.length).padStart(3, '0')}.json`), input);
      console.log(JSON.stringify({ question: question.id, outcome, pass: row.contentPass, score: row.contentScore, milliseconds: raw.latencyMs }));
      if (outcome === 'environment_error') break; // do not keep billing a broken endpoint
    }
  } finally {
    save(join(dir, 'submission.json'), input);
    const scored = { ...scoreStructuralSubmission(pack, input), codeHash: codeHash(), submissionHash: snapshotHash(input), conditions: plan };
    save(join(dir, 'scored.json'), scored);
    status({ state: input.answers.length === pack.questions.length && input.answers.every(a => a.outcome !== 'environment_error') ? 'completed' : 'incomplete', recorded: input.answers.length, planned: pack.questions.length, dimensions: scored.dimensions });
    console.log(JSON.stringify({ recorded: input.answers.length, dimensions: scored.dimensions, productionEligible: false }));
  }
} else throw new Error(usage);
