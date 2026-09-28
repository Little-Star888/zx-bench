// Single publication gate: 14 reference answers and 14 targeted defects.
// No model calls, no broad regression suite.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';
import {validateScenario} from '../packages/core/dist/contracts/validateScenario.js';
import {structuredContractV2Evaluator,structuredContractV3Evaluator,prepareExtendedContract} from '../packages/core/dist/evaluators/structuredContractV2.js';
const root='data/pilots/structured-contract-challenge-v1',manifest=JSON.parse(fs.readFileSync(`${root}/manifest.json`));
const pack=JSON.parse(fs.readFileSync(`${root}/development.json`)),gold=JSON.parse(fs.readFileSync(`${root}/gold.json`));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
if(pack.length!==14||gold.length!==14||sha(pack)!==manifest.hashes.development||sha(gold)!==manifest.hashes.gold)throw Error('Frozen pack drift');
const rows=[];
for(const s of pack){
  if(s.scenarioHash!==hashScenarioShort(s)||validateScenario(s).errors.length)throw Error(`Invalid definition ${s.id}`);
  prepareExtendedContract(s.requirements);
  const reference=gold.find(x=>x.id===s.id),grader=s.graderVersion==='structured_contract_v3'?structuredContractV3Evaluator:structuredContractV2Evaluator;
  if(!reference||reference.raw===reference.negative)throw Error(`Missing distinct oracle ${s.id}`);
  const good=await grader.evaluate(s,reference.raw,{},{}),bad=await grader.evaluate(s,reference.negative,{},{});
  if(good.totalScore!==100||bad.totalScore!==0||good.environmentError||bad.environmentError)
    throw Error(JSON.stringify({id:s.id,good:good.criterionResults,bad:bad.criterionResults,goodError:good.environmentError,badError:bad.environmentError}));
  rows.push({id:s.id,family:s.requirements.family,positive:good.totalScore,negative:bad.totalScore,
    negativeFailures:bad.criterionResults?.filter(x=>x.status==='fail').map(x=>x.id)});
  console.log(`${s.id}: reference pass, targeted defect fail`);
}
const report={status:'passed',modelCalls:0,count:pack.length,responses:rows.length*2,hashes:manifest.hashes,rows};
fs.writeFileSync(`${root}/local-gate.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,count:report.count,responses:report.responses,modelCalls:0}));
