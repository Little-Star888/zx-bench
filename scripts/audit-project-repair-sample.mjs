import { readFileSync } from 'node:fs';
import { projectRepairEvaluator } from '../packages/core/dist/index.js';

const args=process.argv.slice(2);
const bank=JSON.parse(readFileSync(new URL('../data/scenarios/benchmark.json',import.meta.url),'utf8'));
const meta=JSON.parse(readFileSync(new URL('../data/scenarios/benchmark-meta.json',import.meta.url),'utf8'));
const frozenGold=JSON.parse(readFileSync(new URL('../data/gold/project-repair-maintainer-sample-v1.json',import.meta.url),'utf8'));
const idsArg=args.find(a=>a.startsWith('--ids='));
const ids=idsArg?idsArg.slice(6).split(/[\s,]+/).filter(Boolean):meta.lightweightReleasePolicy.projectRepair.maintainerRiskSample;
const answersArg=args.find(a=>a.startsWith('--answers='));
const loadedAnswers=answersArg?JSON.parse(readFileSync(answersArg.slice(10),'utf8')):frozenGold;
const answers=loadedAnswers.entries
  ? Object.fromEntries(Object.entries(loadedAnswers.entries).map(([id,item])=>[id,item.answer]))
  : loadedAnswers;
const rows=[];
for(const id of ids){
  const scenario=bank.find(item=>item.id===id);
  if(!scenario||scenario.grader!=='project_repair')throw new Error(`Unknown project_repair scenario: ${id}`);
  const baseline=await projectRepairEvaluator.evaluate(scenario,'',{finishReason:'stop',incomplete:false,truncated:false});
  const baselineRejected=baseline.environmentError!==true&&baseline.axisScores?.test_pass!==undefined&&baseline.axisScores.test_pass<100;
  let candidate=null;
  if(typeof answers[id]==='string'){
    const result=await projectRepairEvaluator.evaluate(scenario,answers[id],{finishReason:'stop',incomplete:false,truncated:false});
    candidate={environmentError:result.environmentError===true,testPass:result.axisScores?.test_pass??null,
      verified:result.environmentError!==true&&result.axisScores?.test_pass===100};
  }
  rows.push({id,language:scenario.language,baseline:{environmentError:baseline.environmentError===true,
    testPass:baseline.axisScores?.test_pass??null,rejected:baselineRejected},candidate});
}
const ready=rows.every(row=>row.baseline.rejected&&row.candidate?.verified===true);
const positiveGoldVerified=rows.filter(row=>row.candidate?.verified===true).map(row=>row.id);
const positiveGoldPending=rows.filter(row=>row.candidate?.verified!==true).map(row=>row.id);
console.log(JSON.stringify({version:'project-repair-maintainer-sample-v1',scope:'development_shadow_only',ids,rows,
  positiveGoldVerified,positiveGoldPending,
  readyForOfficialReview:ready,note:'A missing positive answer keeps the item in development; it never becomes a model failure or official score.'},null,2));
if(args.includes('--gate')&&!ready)process.exitCode=1;
