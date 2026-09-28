// Narrow admission gate: only frozen gold and one targeted wrong value per family.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {structuredContractV4Evaluator} from '../packages/core/dist/index.js';

const root=process.argv.includes('--v5')?'data/pilots/structured-contract-frontier-v5':
  process.argv.includes('--v4')?'data/pilots/structured-contract-frontier-v4':
  process.argv.includes('--v3')?'data/pilots/structured-contract-frontier-v3':
  process.argv.includes('--v2')?'data/pilots/structured-contract-frontier-v2':'data/pilots/structured-contract-frontier-v1';
const read=name=>JSON.parse(fs.readFileSync(`${root}/${name}`));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const manifest=read('manifest.json'),development=read('development.json'),holdout=read('holdout.json');
const oracles=read('oracle.private.json'),gold=read('gold.private.json');
for(const [key,value] of Object.entries({development,holdout,oracle:oracles,gold}))
  if(sha(value)!==manifest.hashes[key])throw Error(`${key} changed after freezing`);
if(development.length!==manifest.counts.development||holdout.length!==manifest.counts.holdout
  ||new Set([...development,...holdout].map(s=>s.id)).size!==development.length+holdout.length)throw Error('Invalid pack counts or IDs');
const paired=manifest.version.includes('paired');
if((!paired&&new Set(development.map(s=>s.requirements.sourceGroup)).size!==development.length)
  ||holdout.some(s=>development.some(d=>d.requirements.sourceGroup===s.requirements.sourceGroup)))throw Error('Source groups overlap');
if(paired){
  for(const split of [development,holdout]){
    const groups=new Map();
    for(const s of split){const id=s.requirements.pairId;groups.set(id,[...(groups.get(id)??[]),s]);}
    if([...groups.values()].some(pair=>pair.length!==2||new Set(pair.map(s=>s.requirements.pairVariant)).size!==2
      ||pair[0].requirements.sourceGroup!==pair[1].requirements.sourceGroup))throw Error('Invalid paired source groups');
    if(new Set([...groups.values()].map(pair=>pair[0].requirements.sourceGroup)).size!==groups.size)throw Error('Paper reused across pairs');
  }
}
let positive=0,negative=0;
for(const scenario of [...development,...holdout]){
  const item=gold.find(g=>g.id===scenario.id);
  if(!item||scenario.requirements.oracleHash!==sha(oracles[scenario.id]))throw Error(`Oracle drift: ${scenario.id}`);
  const result=await structuredContractV4Evaluator.evaluate(scenario,item.raw,{});
  if(result.environmentError||result.totalScore!==100||result.structuredContractMetrics?.grounded?.valueAccuracy!==1)
    throw Error(`Gold rejected: ${scenario.id}: ${JSON.stringify(result.evidence??result.criterionResults)}`);
  positive++;
  if(scenario===development.find(x=>x.requirements.challengeFamily===scenario.requirements.challengeFamily)){
    const wrongJson=()=>{
      const value=JSON.parse(item.raw);
      const change=node=>{
        if(Array.isArray(node))return node.some(change);
        if(node&&typeof node==='object'){
          for(const key of Object.keys(node)){
            if(node[key]&&typeof node[key]==='object'){if(change(node[key]))return true;}
            else if(typeof node[key]==='string'){node[key]=`${node[key]}__wrong`;return true;}
            else if(typeof node[key]==='number'){node[key]++;return true;}
          }
        }
        return false;
      };
      if(!change(value))throw Error(`No mutable gold leaf: ${scenario.id}`);
      return JSON.stringify(value);
    };
    const bad=scenario.requirements.format==='json'
      ?wrongJson()
      :scenario.requirements.format==='csv'
        ?item.raw.replace(/(\r?\n)[^,\r\n]+/,'$1wrong-ticket')
        :item.raw.replace(/<ticket>[^<]+<\/ticket>/,'<ticket>wrong-ticket</ticket>');
    if(bad===item.raw)throw Error(`Negative construction failed: ${scenario.id}`);
    const failed=await structuredContractV4Evaluator.evaluate(scenario,bad,{});
    if(failed.environmentError||failed.totalScore!==0||failed.structuredContractMetrics?.contentValid!==false)
      throw Error(`Wrong value accepted: ${scenario.id}`);
    negative++;
  }
}
const report={status:'passed',counts:{positive,negative},hashes:manifest.hashes,checkedAt:new Date().toISOString(),
  scope:'Frozen gold and one targeted wrong value per family. No model calls, no full regression suite.'};
fs.writeFileSync(`${root}/local-gate.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
