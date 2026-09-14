/** Frozen, opt-in candidate evaluation. Never writes benchmark history or model configuration. */
import { createHash, createDecipheriv, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotHash } from '../contracts/pack.js';
import { buildExamPaper, assertExamPaper, scoreExam, examMessages, referenceOutput, type ExamSubmission as Submission, type ExamPaper as Pack } from '../evaluationLab/examPaper/index.js';
import { apiControlStream } from '../evaluationLab/apiControlStream.js';
import { API_CONTROL_PROVIDERS, allowedReturnedModel } from '../evaluationLab/apiControlPlan.js';

const PROVIDERS = [...API_CONTROL_PROVIDERS, { key: 'qwen-nvfp4', configId: '086461bc-49c6-4bd6-b4b8-f8260be0f71f', requestedModel: 'qwen3.8-27b-nvfp4', family: 'Qwen3.8', endpoint: 'http://127.0.0.1:8081/v1/chat/completions', parameters: { temperature: 0.6, top_p: 0.95 } }] as const;
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const [mode, ...args] = process.argv.slice(2);
const usage = `progressive-exam export NEW_PACK_DIR SEED
  verify PACK_DIR
  grade PACK_DIR SUBMISSION NEW_RESULT
  prepare-run PACK_DIR NEW_RUN_DIR deepseek-v4-flash|qwen-nvfp4|glm-5.2 MAX_TOKENS
  run RUN_DIR
Each run uses one attempt per subquestion, previous submitted answers within the same big question, no tools or Judge, and the stored provider configuration.`;
const read = (p: string) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const save = (p: string, data: unknown) => writeFileSync(resolve(root, p), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const sourceFiles = ['types.ts', 'optimization.ts', 'extraction.ts', 'evidence.ts', 'index.ts', 'annihilatingMaps.ts'].map(n => 'packages/core/src/evaluationLab/frontierChallenge/' + n)
  .concat(['types.ts','math.ts','extraction.ts','evidence.ts','index.ts'].map(n=>'packages/core/src/evaluationLab/structuralChallenge/'+n))
  .concat(['packages/core/src/evaluationLab/examPaper/index.ts', 'packages/core/src/scripts/progressive-exam.ts', 'packages/core/src/contracts/pack.ts',
    ...['challengeTypes.ts', 'linearOptimizationCertificate.ts', 'methodsV2/types.ts', 'methodsV2/verify.ts', 'apiControlStream.ts', 'he001JudgeTrial.ts', 'apiControlPlan.ts'].map(n => 'packages/core/src/evaluationLab/' + n)]);
const codeFiles = () => Object.fromEntries(sourceFiles.map(p => [p, createHash('sha256').update(readFileSync(join(root, p))).digest('hex')]));
const codeHash = () => snapshotHash(codeFiles());
function verify(directory: string): Pack {
  const dir = resolve(root, directory), pack = read(join(dir, 'coordinator/frozen-pack.json')) as Pack;
  assertExamPaper(pack);
  const manifest = read(join(dir, 'manifest.json')), publicPack = read(join(dir, 'candidate-questions.json'));
  if (manifest.codeHash !== codeHash() || snapshotHash(manifest.codeFiles) !== snapshotHash(codeFiles()) || manifest.contractHash !== pack.contractHash ||
      manifest.publicHash !== snapshotHash(publicPack) || snapshotHash(publicPack) !== snapshotHash({ contractHash: pack.contractHash, questions: pack.questions })) throw new Error('Frozen code/public pack mismatch');
  return pack;
}
type Provider = typeof PROVIDERS[number];
function configuration(provider: Provider) {
  const db = new DatabaseSync(join(root, 'apps/data/zxbench.db'), { readOnly: true });
  let row: { name: string; baseUrl: string; apiKey: string } | undefined;
  try { row = db.prepare('SELECT name,baseUrl,apiKey FROM ModelConfig WHERE id=?').get(provider.configId) as typeof row; } finally { db.close(); }
  if (!row || row.name !== provider.requestedModel || (!row.apiKey && provider.key !== 'qwen-nvfp4')) throw new Error('Stored provider configuration missing or changed');
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
else if (mode === 'export' && args.length === 2) {
  const [target, seed] = args;
  const dir = resolve(root, target); if (existsSync(dir)) throw new Error('Export requires a new directory');
  const pack = buildExamPaper({ seed: Number(seed) });
  const input: Submission = { contractHash: pack.contractHash, runId: 'oracle-QA-NOT-model', modelId: 'reference', modelFamily: 'reference',
    answers: pack.parts.map(c => ({ id: c.id, questionHash: c.question.questionHash, outcome: 'completed', output: referenceOutput(c) })) };
  const qa = scoreExam(pack, input); if (qa.rows.some(r => r.earned !== r.points)) throw new Error('Oracle QA failed');
  mkdirSync(join(dir, 'coordinator'), { recursive: true });
  const publicPack = { contractHash: pack.contractHash, questions: pack.questions };
  save(join(dir, 'candidate-questions.json'), publicPack); save(join(dir, 'coordinator/frozen-pack.json'), pack);
  save(join(dir, 'coordinator/reference-QA-not-model.json'), { input, qa });
  save(join(dir, 'manifest.json'), { contractHash: pack.contractHash, publicHash: snapshotHash(publicPack), codeHash: codeHash(), codeFiles: codeFiles(),
    createdAt: new Date().toISOString(), options: pack.options, policy: pack.policy, questions: pack.parts.length, modelCalls: 0, judgeCalls: 0 });
  save(join(dir, 'submission-template.json'), { contractHash: pack.contractHash, runId: 'REPLACE', modelId: 'REPLACE', modelFamily: 'REPLACE_WITH_BASE_MODEL_FAMILY', answers: [] });
  writeFileSync(join(dir, '题面.md'), '# 递进式数学试卷' + '\n\n每道大题四问分开提交，共享该大题先前已提交答案，无正确性反馈。两道大题相互独立。\n\n' +
    pack.questions.map(q => '## ' + q.id + '\n\n' + q.messages[0].content + '\n').join('\n'), { flag: 'wx' });
  console.log(JSON.stringify({ dir, questions: pack.parts.length, oracleChecks: qa.rows.length, modelCalls: 0 }));
} else if (mode === 'verify' && args.length === 1) {
  const pack = verify(args[0]); console.log(JSON.stringify({ verified: true, questions: pack.parts.length, contractHash: pack.contractHash }));
} else if (mode === 'grade' && args.length === 3) {
  const pack = verify(args[0]), input = read(args[1]), result = { ...scoreExam(pack, input), codeHash: codeHash(), submissionHash: snapshotHash(input) };
  save(args[2], result); console.log(JSON.stringify({ result: resolve(root, args[2]), groups: result.groups, score: result.score, earned: result.earned }));
} else if (mode === 'prepare-run' && args.length === 4) {
  const [packDir, target, providerKey, tokens] = args, pack = verify(packDir), provider = PROVIDERS.find(p => p.key === providerKey);
  const maxTokens = Number(tokens);
  if (!provider || !Number.isInteger(maxTokens) || maxTokens < 1024 || maxTokens > 90000) throw new Error('Invalid provider/budget');
  configuration(provider);
  const dir = resolve(root, target); if (existsSync(dir)) throw new Error('Run requires a new directory'); mkdirSync(dir, { recursive: true });
  const plan = { packDir: resolve(root, packDir), contractHash: pack.contractHash, provider, maxTokens, hardSecondsByPart: Object.fromEntries(pack.parts.map(p => [p.id, p.hardSeconds])), concurrency: 1, automaticRetries: 0,
    requestedQuestions: pack.questions.length, freshContextPerGroup: true, carryOnlySubmittedAnswersWithinGroup: true, answerFeedback: false, tools: false, judgeCalls: 0, productionWrites: false,
    budgetScope: 'provider-specific thinking; same token/time caps do not imply equal compute', codeHash: codeHash() };
  save(join(dir, 'plan.json'), plan); save(join(dir, 'plan-hash.json'), { hash: snapshotHash(plan) });
  console.log(JSON.stringify({ prepared: dir, questions: pack.questions.length, provider: provider.key, maxTokens, hardSecondsByPart: plan.hardSecondsByPart }));
} else if (mode === 'run' && args.length === 1) {
  const dir = resolve(root, args[0]), plan = read(join(dir, 'plan.json')), provider = PROVIDERS.find(p => p.key === plan.provider.key);
  const verifyRun = () => {
    if (snapshotHash(read(join(dir, 'plan.json'))) !== snapshotHash(plan) || snapshotHash(plan) !== read(join(dir, 'plan-hash.json')).hash ||
        plan.codeHash !== codeHash() || !provider || snapshotHash(provider) !== snapshotHash(plan.provider)) throw new Error('Frozen run plan mismatch');
    const p = verify(plan.packDir); if (p.contractHash !== plan.contractHash) throw new Error('Run pack mismatch'); return p;
  };
  const pack = verifyRun(), config = configuration(provider!), key = decrypt(config.encryptedKey ?? '');
  const checkLocal = async () => {
    if (provider!.key !== 'qwen-nvfp4') return;
    const db = new DatabaseSync(join(root, 'apps/data/zxbench.db'), { readOnly: true });
    try { if (db.prepare("SELECT id FROM EvalRun WHERE status='running' LIMIT 1").get()) throw new Error('Formal evaluation is active'); } finally { db.close(); }
    const response = await fetch('http://127.0.0.1:8081/v1/models', { signal: AbortSignal.timeout(5000), redirect: 'error' });
    const models = await response.json() as {data?: {id:string}[]};
    if (!response.ok || models.data?.length !== 1 || models.data[0].id !== provider!.requestedModel) throw new Error('Expected local model is not loaded');
  };
  await checkLocal();
  if (existsSync(join(dir, 'STOP'))) throw new Error('Run is stopped');
  save(join(dir, 'RUN_STARTED.json'), { startedAt: new Date().toISOString(), pid: process.pid }); // wx prevents retries
  const input: Submission = { contractHash: pack.contractHash, runId: dir, modelId: provider!.requestedModel, modelFamily: provider!.family, answers: [] };
  const status = (value: object) => {
    writeFileSync(join(dir, 'status.json.tmp'), JSON.stringify({ ...value, updatedAt: new Date().toISOString() }, null, 2));
    renameSync(join(dir, 'status.json.tmp'), join(dir, 'status.json'));
  };
  try {
    for (const part of pack.parts) {
      const question = part.question;
      verifyRun(); if (existsSync(join(dir, 'STOP'))) break; await checkLocal();
      const itemDir = join(dir, question.id); mkdirSync(itemDir);
      const body = { model: provider!.requestedModel, messages: examMessages(pack, part, input.answers), ...provider!.parameters, max_tokens: plan.maxTokens, stream: true };
      save(join(itemDir, 'request.json'), { endpoint: config.endpoint, body, questionHash: question.questionHash });
      const active = { state: 'running', completed: input.answers.length, planned: pack.questions.length, question: question.id, group: part.groupId, part: part.number, points: part.points, hardSeconds: part.hardSeconds };
      status(active); console.log(JSON.stringify(active)); let last = 0;
      const raw = await apiControlStream({ endpoint: config.endpoint, key, body, wireFile: join(itemDir, 'wire.sse'), stopFile: join(dir, 'STOP'), timeoutMs: part.hardSeconds * 1000,
        onProgress: progress => { if (Date.now() - last >= 5000) { last = Date.now(); status({ ...active, progress }); } } });
      save(join(itemDir, 'raw.json'), raw);
      const modelValid = provider!.key === 'qwen-nvfp4'
        ? raw.returnedModels.length > 0 && raw.returnedModels.every(m => m === provider!.requestedModel)
        : allowedReturnedModel(provider!.key, raw.returnedModels);
      // A truncated response from the wrong model is still an infrastructure failure.
      const error = !modelValid ? 'unexpected_or_missing_returned_model' : raw.error;
      const outcome = existsSync(join(dir, 'STOP')) ? 'environment_error' : error === 'timeout_or_cancelled' ? 'timeout' : error === 'truncated' ? 'truncated' : error ? 'environment_error' : 'completed';
      save(join(itemDir, 'outcome.json'), { outcome, error, modelValid });
      input.answers.push({ id: question.id, questionHash: question.questionHash, outcome, output: raw.content });
      const scored = scoreExam(pack, input), row = scored.rows.find(r => r.id === question.id)!;
      save(join(itemDir, 'grade.json'), row);
      save(join(dir, `submission-${String(input.answers.length).padStart(3, '0')}.json`), input);
      console.log(JSON.stringify({ question: question.id, outcome, earned: row.earned, points: row.points, paperEarned: scored.earned, milliseconds: raw.latencyMs }));
      if (outcome === 'environment_error') break; // do not keep billing a broken endpoint
    }
  } finally {
    save(join(dir, 'submission.json'), input);
    const scored = { ...scoreExam(pack, input), codeHash: codeHash(), submissionHash: snapshotHash(input), conditions: plan };
    save(join(dir, 'scored.json'), scored);
    status({ state: input.answers.length === pack.questions.length && input.answers.every(a => a.outcome !== 'environment_error') ? 'completed' : 'incomplete', recorded: input.answers.length, planned: pack.questions.length, groups: scored.groups, earned: scored.earned, score: scored.score });
    console.log(JSON.stringify({ recorded: input.answers.length, groups: scored.groups, earned: scored.earned, score: scored.score, productionEligible: false }));
  }
} else throw new Error(usage);
