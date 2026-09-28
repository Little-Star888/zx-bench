// One high-dependency screening item. Expand only if it separates on a real content error.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';
const root='data/pilots/structured-contract-frontier-v2';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'},nonnegative={type:'integer',minimum:0};
const sources={
  identities:[
    {id:'I1',alias:'A/01',accountId:'AC-01',active:true},
    {id:'I2',alias:'A/1',accountId:'AC-02',active:true},
    {id:'I3',alias:'C~03',accountId:'AC-03',active:true},
  ],
  plans:[
    {id:'P1',accountId:'AC-01',monthlyCap:12,starts:'2026-09-01',services:['compute','storage']},
    {id:'P2',accountId:'AC-02',monthlyCap:9,starts:'2026-09-01',services:['storage']},
    {id:'P3',accountId:'AC-03',monthlyCap:7,starts:'2026-09-05',services:['compute']},
  ],
  events:[
    {id:'E4',alias:'A/01',service:'compute',units:5,day:'2026-09-06'},
    {id:'E2',alias:'A/1',service:'storage',units:4,day:'2026-09-04'},
    {id:'E6',alias:'C~03',service:'compute',units:6,day:'2026-09-07'},
    {id:'E1',alias:'A/01',service:'compute',units:5,day:'2026-09-03'},
    {id:'E8',alias:'A/01',service:'storage',units:2,day:'2026-09-08'},
    {id:'E9',alias:'A/1',service:'storage',units:8,day:'2026-09-09'},
    {id:'E3',alias:'A/01',service:'storage',units:6,day:'2026-09-05'},
    {id:'E5',alias:'C~03',service:'compute',units:3,day:'2026-09-04'},
    {id:'E7',alias:'A/1',service:'compute',units:3,day:'2026-09-08'},
  ],
  revisions:[
    {id:'R1',target:'E3',revision:4,units:8},
    {id:'R2',target:'E8',revision:2,void:true},
    {id:'R3',target:'E3',revision:1,units:7},
    {id:'R4',target:'E9',revision:3,units:7},
  ],
};
const sourceMap=Object.fromEntries(Object.entries(sources).flatMap(([group,items])=>items.map(x=>[x.id,`${group}: ${JSON.stringify(x)}`])));
const spent=Object.fromEntries(sources.plans.map(x=>[x.accountId,0]));
const records=[...sources.events].sort((a,b)=>a.day.localeCompare(b.day)||a.id.localeCompare(b.id)).map(event=>{
  const identity=sources.identities.find(x=>x.alias===event.alias),plan=sources.plans.find(x=>x.accountId===identity.accountId);
  const revision=sources.revisions.filter(x=>x.target===event.id).sort((a,b)=>b.revision-a.revision)[0];
  const units=revision?.units??event.units;
  const reason=revision?.void?'void':!identity.active?'inactive':event.day<plan.starts?'before_start':
    !plan.services.includes(event.service)?'service':null;
  const billedUnits=reason?0:Math.min(units,Math.max(0,plan.monthlyCap-spent[identity.accountId]));
  spent[identity.accountId]+=billedUnits;
  const rejectedUnits=units-billedUnits;
  return {eventId:event.id,accountId:identity.accountId,units,billedUnits,rejectedUnits,
    status:reason?'excluded':rejectedUnits?'capped':'billed',...(reason?{reason}:rejectedUnits?{reason:'cap'}:{}),
    sourceIds:[event.id,...(revision?[revision.id]:[]),identity.id,plan.id]};
});
const expected={records,totals:sources.plans.map(plan=>({accountId:plan.accountId,billedUnits:spent[plan.accountId]}))};
const provenance={};
function walk(value,path='',ids=[]){
  if(Array.isArray(value))value.forEach((item,i)=>walk(item,`${path}/${i}`,ids));
  else if(value&&typeof value==='object'){
    const next=Array.isArray(value.sourceIds)?value.sourceIds:ids;
    for(const [key,item] of Object.entries(value))walk(item,`${path}/${key}`,next);
  }else provenance[path]=ids;
}
walk(expected);
for(const [i,total] of expected.totals.entries()){
  const ids=records.filter(r=>r.accountId===total.accountId).flatMap(r=>r.sourceIds);
  provenance[`/totals/${i}/accountId`]=[...new Set(ids)];
  provenance[`/totals/${i}/billedUnits`]=[...new Set(ids)];
}
const oracle={expected,sources:sourceMap,provenance};
const common={eventId:str,accountId:str,units:nonnegative,billedUnits:nonnegative,rejectedUnits:nonnegative,
  sourceIds:{type:'array',items:str,minItems:3,maxItems:4}};
const row={oneOf:[
  obj({...common,status:{const:'billed'}}),
  obj({...common,status:{const:'capped'},reason:{const:'cap'}}),
  obj({...common,status:{const:'excluded'},reason:{enum:['void','inactive','before_start','service']}}),
]};
const schema={$schema:'https://json-schema.org/draft/2020-12/schema',...obj({records:{type:'array',items:row,minItems:9,maxItems:9},
  totals:{type:'array',items:obj({accountId:str,billedUnits:nonnegative}),minItems:3,maxItems:3}})};
const id='SOC4-E-CAP-LEDGER';
const req={format:'json',dialect:'2020-12',schema,formatAssertions:true,family:'frontier_E',challengeFamily:'E',
  sourceGroup:'monthly-cap-sequential-ledger-v1',output_policy:'raw_only',oracleSet:'frontier-v2',oracleRef:id,oracleHash:sha(oracle),
  provenance:{sourcePack:'structured-contract-frontier-v2',method:'Locally authored source ledger and deterministic replay; not an official benchmark item'}};
const prompt=`按以下来源记录重建 2026-09 月用量账本。\n`
  +`先按 alias 精确匹配 identities（A/01 与 A/1 是不同账户）；每条事件采用 revision 数值最大的修订，未声明的字段保留原值，void=true 则事件排除。\n`
  +`把事件按 day 升序、同日按事件 ID 升序处理，并以此顺序输出 records；不是按输入顺序，也不是按 revision 顺序。\n`
  +`判断排除原因的优先级：void、inactive、day 早于 plan.starts、服务不在 plan.services。排除事件 billedUnits=0、rejectedUnits=修订后 units、status=excluded，reason 填对应原因。\n`
  +`其他事件共享各自账户的 monthlyCap，按处理顺序扣额度：billedUnits=min(修订后 units,剩余额度)，rejectedUnits=剩余部分。rejectedUnits=0 时 status=billed 且不得写 reason；否则 status=capped 且 reason=cap，即使 billedUnits=0。\n`
  +`totals 按 plans 顺序列 accountId 与最终 billedUnits 总和。每行 sourceIds 只列本事件、最终采用的最高 revision（若有）、identity、plan 的记录 ID，按此顺序；被覆盖的 revision 不列。\n`
  +Object.entries(sources).map(([group,items])=>`${group}：\n${items.map(x=>`[${x.id}] ${JSON.stringify(x)}`).join('\n')}`).join('\n')
  +`\n仅输出完整 JSON 原文，符合此 Schema：${JSON.stringify(schema)}；不得写围栏或解释。`;
const scenario={id,dimension:'structured_output',category:'frontier_sequential_entitlement',difficulty:'adversarial',language:'json',
  locale:'zh-CN',status:'valid',tier:'private_validation',promptTemplate:prompt,grader:'structured_contract',
  graderVersion:'structured_contract_v4',scenarioVersion:'1.0.0',scoring:{type:'schema_compliance'},requirements:req,
  outputPolicy:'raw_only',reviewStatus:'verified',goldSource:'local-derived-fixture-v1',goldVerifiedAt:'2026-09-26T12:00:00.000Z',
  tags:['structured-contract-frontier-v2','family:E','development_only']};
scenario.scenarioHash=hashScenarioShort(scenario);
const development=[scenario],holdout=[],gold=[{id,split:'development',raw:JSON.stringify(expected)}],oracles={[id]:oracle};
const manifest={version:'structured-contract-frontier-v2',status:'single-item-design-screen',
  counts:{development:1,holdout:0},splitPolicy:'One development design probe; no holdout or general difficulty claim yet.',
  hashes:{development:sha(development),holdout:sha(holdout),oracle:sha(oracles),gold:sha(gold)},modelCalls:0};
fs.mkdirSync(root,{recursive:true});
for(const [name,value] of Object.entries({'development.json':development,'holdout.json':holdout,'oracle.private.json':oracles,
  'gold.private.json':gold,'manifest.json':manifest}))fs.writeFileSync(`${root}/${name}`,JSON.stringify(value,null,2)+'\n');
console.log(JSON.stringify({id,records:records.length,expected,hashes:manifest.hashes}));
