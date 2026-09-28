// Frozen paired probes for policy comprehension vs executable JSON Schema synthesis.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';

const root='data/pilots/structured-contract-frontier-v6';
const selections=[
  {split:'development',source:'data/pilots/structured-contract-challenge-v1',id:'SOC3-G-AUTH'},
  {split:'development',source:'data/pilots/structured-contract-challenge-v1',id:'SOC3-G-ARRAY'},
  {split:'holdout',source:'data/pilots/structured-contract-v2',id:'SOC2-G-H-1'},
  {split:'holdout',source:'data/pilots/structured-contract-v2',id:'SOC2-G-H-2'}
];
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const development=[],holdout=[],gold=[];
for(const {split,source,id} of selections){
  const sourceScenario=read(`${source}/${split}.json`).find(x=>x.id===id);
  const sourceGold=read(`${source}/${source.includes('challenge')?'gold.json':`${split}-gold.json`}`).find(x=>x.id===id);
  if(!sourceScenario?.requirements?.generatedSchema?.cases?.length||!sourceGold?.raw)throw Error(`Missing source ${id}`);
  const cases=sourceScenario.requirements.generatedSchema.cases;
  const validIds=cases.flatMap((c,i)=>c.valid?[String(i+1).padStart(2,'0')]:[]);
  const family=id.endsWith('ARRAY')?'schema_synthesis_array':id.endsWith('AUTH')?'schema_synthesis_auth':'schema_synthesis_policy';
  const pairId=`SYN-${id}`;
  const rules=sourceScenario.promptTemplate.split('输出须满足 JSON Schema：')[0]
    .split('输出必须遵循这个 Schema：')[0].trim();
  const baseSchema={type:'object',properties:{validIds:{type:'array',items:{type:'string',pattern:'^[0-9]{2}$'},uniqueItems:true}},required:['validIds'],additionalProperties:false};
  const base={...sourceScenario,id:`${pairId}-BASE`,category:'schema_synthesis_pair',difficulty:'unverified',
    promptTemplate:`按以下规则判断每个样本是否有效。只输出一个 JSON 对象，validIds 为有效样本的两位编号数组，按编号升序排列。不要解释。\n\n规则：\n${rules}\n\n样本：\n${cases.map((c,i)=>`${String(i+1).padStart(2,'0')}: ${JSON.stringify(c.data)}`).join('\n')}\n\n输出 Schema：${JSON.stringify(baseSchema)}`,
    requirements:{format:'json',dialect:'2020-12',schema:baseSchema,formatAssertions:true,
      assertions:[{pointer:'/validIds',expected:validIds,description:'All finite examples classified exactly'}],
      family:`${family}_base`,pairId,pairVariant:'base',sourceGroup:id,output_policy:'raw_only',
      provenance:{sourceScenario:id,adaptation:'Finite-case classification of the same policy; no schema synthesis'}},
    graderVersion:'structured_contract_v2',reviewStatus:'paired_probe_unverified',tags:['schema-synthesis-paired','base']};
  const structured={...sourceScenario,id:`${pairId}-STRUCTURED`,category:'schema_synthesis_pair',difficulty:'unverified',
    requirements:{...sourceScenario.requirements,family:`${family}_structured`,pairId,pairVariant:'structured',sourceGroup:id,
      provenance:{sourceScenario:id,adaptation:'Original executable-schema synthesis and behavioral oracle'}},
    reviewStatus:'paired_probe_unverified',tags:['schema-synthesis-paired','structured']};
  for(const [variant,s,raw] of [['base',base,JSON.stringify({validIds})],['structured',structured,sourceGold.raw]]){
    delete s.scenarioHash;s.scenarioHash=hashScenarioShort(s);
    (split==='development'?development:holdout).push(s);
    gold.push({id:s.id,split,pairId,variant,raw});
  }
}
const manifest={version:'structured-contract-frontier-v6-schema-paired',status:'development-only',
  counts:{development:development.length,holdout:holdout.length},
  source:{adaptedFrom:selections,policy:'Same written rules; finite-case decision vs executable JSON Schema. Holdout is task-group separated but not source-repository independent.'},
  hashes:{development:sha(development),holdout:sha(holdout),gold:sha(gold)},modelCalls:0};
fs.mkdirSync(root,{recursive:true});
for(const [name,value] of Object.entries({'development.json':development,'holdout.json':holdout,'gold.private.json':gold,'manifest.json':manifest}))
  fs.writeFileSync(`${root}/${name}`,JSON.stringify(value,null,2)+'\n');
console.log(JSON.stringify({root,counts:manifest.counts,hashes:manifest.hashes}));
