// Mandatory local oracle gate. No model calls.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {structuredContractV2Evaluator,structuredContractV3Evaluator} from '../packages/core/dist/index.js';
const root=process.argv[2]??'data/pilots/structured-contract-frontier-v6',read=n=>JSON.parse(fs.readFileSync(`${root}/${n}.json`,'utf8'));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const manifest=read('manifest'),development=read('development'),holdout=read('holdout'),gold=read('gold.private');
for(const [name,data] of Object.entries({development,holdout,gold}))if(sha(data)!==manifest.hashes[name])throw Error(`Frozen ${name} drift`);
let positive=0,negative=0;
for(const scenario of [...development,...holdout]){
  const witness=gold.find(x=>x.id===scenario.id),evalr=scenario.graderVersion==='structured_contract_v3'?structuredContractV3Evaluator:structuredContractV2Evaluator;
  const ok=await evalr.evaluate(scenario,witness.raw,{});
  if(ok.environmentError||ok.structuredContractMetrics?.complete!==true)throw Error(`Witness rejected: ${scenario.id} ${JSON.stringify(ok.evidence)}`);
  positive++;
  const wrong=scenario.requirements.pairVariant==='base'?JSON.stringify({validIds:[]}):'{}';
  const bad=await evalr.evaluate(scenario,wrong,{});
  if(bad.environmentError||bad.structuredContractMetrics?.complete!==false)throw Error(`Negative accepted: ${scenario.id}`);
  negative++;
}
const report={status:'passed',counts:{positive,negative},hashes:manifest.hashes,checkedAt:new Date().toISOString(),scope:'Frozen witnesses and directed negatives; no model calls.'};
fs.writeFileSync(`${root}/local-gate.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
