import {readFileSync} from 'node:fs';
import {buildChallengePack} from '../packages/core/dist/evaluationLab/challengePack.js';
import {lightweightDiscriminationGate} from '../packages/core/dist/evaluationLab/observedDiscrimination.js';

const pack=buildChallengePack();
const previous=JSON.parse(readFileSync(new URL('../reports/challenge-citation-regrade-2026-09-10-v1.3.0/regrade.json',import.meta.url),'utf8'));
const third=JSON.parse(readFileSync(new URL('../reports/challenge-third-model-deepseek-v4-flash-2026-09-13-v1/deepseek-v4-flash/grades-020.json',import.meta.url),'utf8'));
const families=new Map(pack.cases.map(item=>[item.id,item.family]));
const models=previous.models.map((model,index)=>({modelId:model.model,modelFamily:index===0?'Qwen3.8-GSQ':'Ornith-1.5',executionClass:'local_unsloth',rows:model.rows.map(row=>({id:row.id,family:families.get(row.id),pass:row.strictPass,state:'completed'}))}));
models.push({modelId:'deepseek-v4-flash',modelFamily:'DeepSeek',executionClass:'provider_api',rows:third.map(row=>({id:row.id,family:families.get(row.id),pass:row.strictPass,state:'completed'}))});
const report=Object.fromEntries(['hallucination_resistance','reasoning_math'].map(dimension=>{
  const selected=models.map(model=>({...model,rows:model.rows.filter(row=>pack.cases.find(item=>item.id===row.id)?.dimension===dimension)}));
  return [dimension,lightweightDiscriminationGate(dimension,selected)];
}));
const output=process.argv.includes('--summary')?Object.fromEntries(Object.entries(report).map(([dimension,row])=>[dimension,{
  models:row.models,scoreSpread:row.scoreSpread,separatingRate:row.separatingRate,allPassItems:row.allPassItems,
  allFailItems:row.allFailItems,readyForMaintainerFreeze:row.readyForMaintainerFreeze,disposition:row.disposition,
}])):report;
console.log(JSON.stringify(output,null,2));
