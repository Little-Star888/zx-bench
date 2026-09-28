import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { structuredContractEvaluator, prepareStructuredContract } from '../packages/core/dist/evaluators/structuredContract.js';
import { validateScenario } from '../packages/core/dist/contracts/validateScenario.js';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';
import {structuredContractV2Evaluator,prepareExtendedContract} from '../packages/core/dist/evaluators/structuredContractV2.js';
const arg=process.argv.indexOf('--pack');
const root=arg>=0?process.argv[arg+1]:'data/pilots/structured-contract-v1';
const manifest=JSON.parse(fs.readFileSync(`${root}/manifest.json`,'utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const rows=[];
for(const source of manifest.sources??[]){
  if(sha(fs.readFileSync(`${root}/${source.path}`))!==source.sha256)throw Error(`Source drift: ${source.name}`);
}
for(const split of ['development','holdout']){
  const pack=JSON.parse(fs.readFileSync(`${root}/${split}.json`,'utf8'));
  const gold=JSON.parse(fs.readFileSync(`${root}/${split}-gold.json`,'utf8'));
  if(sha(JSON.stringify(pack))!==manifest.hashes[split])throw Error('Pack drift');
  if(sha(JSON.stringify(gold))!==manifest.goldHashes[split])throw Error('Gold drift');
  for(const s of pack){
    const errors=validateScenario(s).errors;
    if(errors.length||s.scenarioHash!==hashScenarioShort(s))throw Error(`${s.id}: ${JSON.stringify(errors)}`);
    const fixture=gold.find(x=>x.id===s.id);
    const extended=s.graderVersion==='structured_contract_v2';
    (extended?prepareExtendedContract:prepareStructuredContract)(s.requirements);
    const evaluator=extended?structuredContractV2Evaluator:structuredContractEvaluator;
    const correct=await evaluator.evaluate(s,fixture.raw??JSON.stringify(fixture.expected),{});
    const incorrect=await evaluator.evaluate(s,typeof fixture.negative==='string'?fixture.negative:JSON.stringify(fixture.negative),{});
    rows.push({id:s.id,split,correct:correct.totalScore,incorrect:incorrect.totalScore,
      correctSchema:correct.structuredContractMetrics?.schemaValid,incorrectSchema:incorrect.structuredContractMetrics?.schemaValid});
    if(correct.totalScore!==100||incorrect.totalScore!==0||correct.environmentError||incorrect.environmentError){
      throw Error(JSON.stringify({id:s.id,correct,incorrect},null,2));
    }
  }
}
const result={status:'passed',modelCalls:0,scenarios:rows.length,checkedResponses:rows.length*2,
  packHashes:manifest.hashes,goldHashes:manifest.goldHashes,rows};
fs.writeFileSync(`${root}/local-gate.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
