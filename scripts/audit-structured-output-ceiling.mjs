// Audit existing answers only; the current evaluator's complete-check rate is a proxy,
// not a claim of complete JSON Schema or target-runtime conformance.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { structuredOutputEvaluator } from '../packages/core/dist/evaluators/structuredOutput.js';
import { classifyEngineeringFailure } from '../packages/core/dist/scoring.js';

const bank = JSON.parse(readFileSync('data/scenarios/benchmark.json', 'utf8'))
  .filter(s => s.dimension === 'structured_output' && s.status === 'valid');
const current = new Map(bank.map(s => [s.id, s]));
const db = new DatabaseSync('apps/data/zxbench.db', { readOnly: true });
const dateValue = v => typeof v === 'number' || /^\d+$/.test(String(v)) ? Number(v) : Date.parse(v);
const candidates = db.prepare(`SELECT e.id,e.createdAt,e.manifest,m.displayName,m.name AS modelName
  FROM EvalRun e JOIN ModelConfig m ON m.id=e.modelConfigId
  WHERE e.status='completed' AND e.manifest IS NOT NULL`).all()
  .sort((a,b) => dateValue(b.createdAt)-dateValue(a.createdAt));
const rowsQuery = db.prepare(`SELECT scenarioId,modelOutput,totalScore,environmentError,evidence
  FROM ScenarioResult WHERE evalRunId=? AND dimension='structured_output'`);
const runs = [];
for (const run of candidates) {
  const rows = rowsQuery.all(run.id);
  if (rows.length !== bank.length || new Set(rows.map(r=>r.scenarioId)).size !== bank.length
    || rows.some(r=>!current.has(r.scenarioId))) continue;
  const frozen = new Map((JSON.parse(run.manifest).benchmarkPack?.scenarios ?? []).map(s=>[s.id,s]));
  if (rows.some(r=>!frozen.has(r.scenarioId))) continue;
  const answers = [];
  for (const row of rows) {
    const scenario = current.get(row.scenarioId);
    const failure = classifyEngineeringFailure({ ...row, environmentError: !!row.environmentError });
    const samePrompt = frozen.get(row.scenarioId).promptTemplate === scenario.promptTemplate;
    const grade = failure ? null : await structuredOutputEvaluator.evaluate(scenario,row.modelOutput,{},{});
    if (grade?.environmentError) throw new Error(`Replay infrastructure failure: ${run.id}/${row.scenarioId}`);
    const criteria = grade?.criterionResults ?? [];
    if (grade && !criteria.length) throw new Error(`Missing criteria: ${row.scenarioId}`);
    answers.push({ id:row.scenarioId, format:scenario.requirements?.format, samePrompt, excluded:failure,
      checkPass:grade ? criteria.every(c=>c.status==='pass') : null,
      failed:criteria.filter(c=>c.status!=='pass').map(c=>({id:c.id,description:c.description})),
      partialScore:grade?.totalScore ?? null });
  }
  runs.push({ id:run.id, model:run.displayName || run.modelName, answers });
  if (runs.length===8) break;
}
db.close();
if (runs.length!==8) throw new Error(`Expected 8 recent complete runs, found ${runs.length}`);
const commonIds = bank.map(s=>s.id).filter(id=>runs.every(run=>{
  const a=run.answers.find(x=>x.id===id); return a.samePrompt && !a.excluded;
}));
const commonSet = new Set(commonIds);
const count = rows => ({ n:rows.length, pass:rows.filter(r=>r.checkPass).length,
  rate: rows.length ? rows.filter(r=>r.checkPass).length/rows.length : null });
const perRun = runs.map(run=>({ runId:run.id, model:run.model,
  unchangedPrompt:count(run.answers.filter(a=>a.samePrompt&&!a.excluded)),
  common:count(run.answers.filter(a=>commonSet.has(a.id))),
  excluded:run.answers.filter(a=>a.excluded).map(a=>({id:a.id,reason:a.excluded})),
  changedPrompt:run.answers.filter(a=>!a.samePrompt).map(a=>a.id) }));
const perQuestion=commonIds.map(id=>({id,format:current.get(id).requirements?.format,
  pass:runs.filter(run=>run.answers.find(a=>a.id===id).checkPass).length,total:runs.length}));
const report={createdAt:new Date().toISOString(),bankVersion:JSON.parse(readFileSync('data/scenarios/benchmark-meta.json','utf8')).version,
  metric:'All checks of the existing deterministic evaluator pass; no historical Judge, no new model calls.',
  caveat:'Only declared implemented checks are measured. The eight configurations are not eight independent model families.',
  commonCount:commonIds.length,commonIds,perRun,perQuestion,
  questionPatternCounts:{allPass:perQuestion.filter(x=>x.pass===8).length,
    mixed:perQuestion.filter(x=>x.pass>0&&x.pass<8).length,allFail:perQuestion.filter(x=>x.pass===0).length},runs};
mkdirSync('analysis/structured-output-redesign',{recursive:true});
writeFileSync('analysis/structured-output-redesign/current-checks-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({commonCount:report.commonCount,perRun,questionPatternCounts:report.questionPatternCounts,
  allFailIds:perQuestion.filter(x=>x.pass===0).map(x=>x.id)},null,2));
