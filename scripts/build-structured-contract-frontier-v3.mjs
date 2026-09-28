// Multi-hop source retrieval pilot: one candidate only, no model calls.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';
const root='data/pilots/structured-contract-frontier-v3';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'};
const chains=[
  {seed:'R-07',path:['M-42','V-16','Z-18'],owner:'柳岚',budget:61,oldBudget:45},
  {seed:'R-007',path:['M-49','V-10','Z-21'],owner:'郑宁',budget:47,oldBudget:54},
  {seed:'R-O7',path:['M-46','V-13','Z-19'],owner:'宋乔',budget:58,oldBudget:59},
  {seed:'R-70',path:['M-40','V-11','Z-20'],owner:'费雨',budget:40,oldBudget:33},
];
const facts=[];
let idState=7919413;
const issued=new Set();
function nextId(){let id;do{idState=(idState*1664525+1013904223)>>>0;id=`F-${idState.toString(36).toUpperCase()}`;}while(issued.has(id));issued.add(id);return id;}
const startIds=[];
for(const [ci,chain] of chains.entries()){
  const nodes=[chain.seed,...chain.path];
  const startId=nextId();startIds.push(startId);
  facts.push({id:startId,kind:'seed',text:`本轮需追踪的起点是「${chain.seed}」。`});
  for(let hop=0;hop<3;hop++){
    const from=nodes[hop],to=nodes[hop+1];
    const decoy=chains[(ci+hop+1)%chains.length].path[hop];
    facts.push({id:nextId(),kind:'handoff',from,to:decoy,revision:1,
      text:`交接簿称「${from}」第 1 版后续项目为「${decoy}」；这是保留的旧版本。`});
    facts.push({id:nextId(),kind:'handoff',from,to,revision:2,
      text:`交接簿称「${from}」第 2 版后续项目为「${to}」；这是该节点最新版本。`});
  }
  const terminal=chain.path[2];
  facts.push({id:nextId(),kind:'owner',terminal,owner:chain.owner,text:`项目「${terminal}」的负责人员记录为「${chain.owner}」。`});
  facts.push({id:nextId(),kind:'budget',terminal,revision:1,budget:chain.oldBudget,
    text:`项目「${terminal}」的第 1 版核准预算为 ${chain.oldBudget} 万元。`});
  facts.push({id:nextId(),kind:'budget',terminal,revision:2,budget:chain.budget,
    text:`项目「${terminal}」的第 2 版核准预算为 ${chain.budget} 万元，覆盖同项目更早版本。`});
}
// Interleave unrelated but plausible records; no answer is supplied in one block.
facts.push({id:'X1',kind:'note',text:'归档说明：R-07 和 R-007 是不同编号，字母 O 与数字 0 不可互换。'});
facts.push({id:'X2',kind:'note',text:'旧版交接记录保留用于审计，不表示该记录仍为当前路线。'});
facts.push({id:'X3',kind:'note',text:'预算单位统一为万元，不需要币种换算。'});
let state=24681357;
const shuffled=[...facts].sort(()=>0);
for(let i=shuffled.length-1;i>0;i--){state=(state*1664525+1013904223)>>>0;const j=state%(i+1);[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
const sources=Object.fromEntries(shuffled.map(f=>[f.id,f.text]));
const records=chains.map((chain,ci)=>{
  let current=chain.seed;
  const sourceIds=[startIds[ci]];
  for(let hop=0;hop<3;hop++){
    const candidates=facts.filter(f=>f.kind==='handoff'&&f.from===current).sort((a,b)=>b.revision-a.revision);
    const chosen=candidates[0];if(!chosen)throw Error(`Broken chain ${current}`);
    current=chosen.to;sourceIds.push(chosen.id);
  }
  const owner=facts.find(f=>f.kind==='owner'&&f.terminal===current);
  const budget=facts.filter(f=>f.kind==='budget'&&f.terminal===current).sort((a,b)=>b.revision-a.revision)[0];
  sourceIds.push(owner.id,budget.id);
  return {seed:chain.seed,terminal:current,owner:owner.owner,budget:budget.budget,sourceIds};
});
const expected={records,totalBudget:records.reduce((sum,r)=>sum+r.budget,0)};
const provenance={};
for(const [i,row] of records.entries()){
  for(const key of ['seed','terminal','owner','budget'])provenance[`/records/${i}/${key}`]=row.sourceIds;
  row.sourceIds.forEach((_,j)=>{provenance[`/records/${i}/sourceIds/${j}`]=row.sourceIds;});
}
provenance['/totalBudget']=[...new Set(records.flatMap(r=>r.sourceIds))];
const oracle={expected,sources,provenance};
const rowSchema=obj({seed:str,terminal:str,owner:str,budget:{type:'integer',minimum:0},
  sourceIds:{type:'array',items:str,minItems:6,maxItems:6}});
const schema={$schema:'https://json-schema.org/draft/2020-12/schema',...obj({records:{type:'array',items:rowSchema,minItems:4,maxItems:4},
  totalBudget:{type:'integer',minimum:0}})};
const id='SOC4-F-HANDOFF';
const req={format:'json',dialect:'2020-12',schema,formatAssertions:true,family:'frontier_F',challengeFamily:'F',
  sourceGroup:'shuffled-handoff-dossier-v1',output_policy:'raw_only',oracleSet:'frontier-v3',oracleRef:id,oracleHash:sha(oracle),
  provenance:{sourcePack:'structured-contract-frontier-v3',method:'Locally authored shuffled dossier and deterministic graph traversal; not an official benchmark item'}};
const prompt=`下面是一份被打乱次序的交接档案。只使用档案事实，不凭编号的外观猜测路线。\n`
  +`对每个起点，依次走三次交接；某节点有多版交接时，只采用 revision 数值最大的版本。到达终点后，查该终点负责人及 revision 最大的预算。\n`
  +`records 按起点 R-07、R-007、R-O7、R-70 顺序排列。每条 sourceIds 依次为起点记录、三次最终采用的交接记录、终点负责人记录、终点最终预算记录；旧版交接和旧预算不要列入。totalBudget 为四个终点最终预算之和。\n`
  +shuffled.map((f,i)=>`${String(i+1).padStart(2,'0')}. [${f.id}] ${f.text}`).join('\n')
  +`\n只输出一个完整 JSON，满足以下 Schema：${JSON.stringify(schema)}。不要代码围栏、解释或额外字段。`;
const scenario={id,dimension:'structured_output',category:'frontier_multihop_dossier',difficulty:'adversarial',language:'json',locale:'zh-CN',
  status:'valid',tier:'private_validation',promptTemplate:prompt,grader:'structured_contract',graderVersion:'structured_contract_v4',
  scenarioVersion:'1.0.0',scoring:{type:'schema_compliance'},requirements:req,outputPolicy:'raw_only',reviewStatus:'verified',
  goldSource:'local-derived-fixture-v1',goldVerifiedAt:'2026-09-26T12:00:00.000Z',tags:['structured-contract-frontier-v3','family:F','development_only']};
scenario.scenarioHash=hashScenarioShort(scenario);
const development=[scenario],holdout=[],oracles={[id]:oracle},gold=[{id,split:'development',raw:JSON.stringify(expected)}];
const manifest={version:'structured-contract-frontier-v3',status:'single-item-design-screen',counts:{development:1,holdout:0},
  splitPolicy:'One development design probe; no holdout or general difficulty claim yet.',
  hashes:{development:sha(development),holdout:sha(holdout),oracle:sha(oracles),gold:sha(gold)},modelCalls:0};
fs.mkdirSync(root,{recursive:true});
for(const [name,value] of Object.entries({'development.json':development,'holdout.json':holdout,'oracle.private.json':oracles,
  'gold.private.json':gold,'manifest.json':manifest}))fs.writeFileSync(`${root}/${name}`,JSON.stringify(value,null,2)+'\n');
console.log(JSON.stringify({id,sourceRecords:shuffled.length,expected,hashes:manifest.hashes}));
