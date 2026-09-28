// Prospective paired schema-behavior probes; source rules are local adaptations of
// the behavioral validation method, not official JSONSchemaBench items.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';
const root='data/pilots/structured-contract-frontier-v7';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const acct='12345678',other='87654321';
const debit=(patch={})=>({kind:'debit',id:'AB-0123',payload:{account:acct,amount:1,...patch}});
const credit=(patch={})=>({kind:'credit',id:'CD-9999',payload:{account:acct,amount:5000,source:'wire',...patch}});
const transfer=(patch={})=>({kind:'transfer',id:'EF-1234',payload:{from:acct,to:other,amount:7,priority:'normal',...patch}});
const eventSchema={$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',required:['kind','id','payload'],additionalProperties:false,
  properties:{kind:{enum:['debit','credit','transfer']},id:{type:'string',pattern:'^[A-Z]{2}-[0-9]{4}$'},payload:{type:'object'}},
  oneOf:[
    {properties:{kind:{const:'debit'},payload:{type:'object',required:['account','amount'],additionalProperties:false,
      properties:{account:{type:'string',pattern:'^[0-9]{8}$'},amount:{type:'integer',minimum:1,maximum:5000},memo:{type:'string',minLength:1}}}}},
    {properties:{kind:{const:'credit'},payload:{type:'object',required:['account','amount','source'],additionalProperties:false,
      properties:{account:{type:'string',pattern:'^[0-9]{8}$'},amount:{type:'integer',minimum:1,maximum:5000},source:{enum:['cash','wire']}}}}},
    {properties:{kind:{const:'transfer'},payload:{type:'object',required:['from','to','amount','priority'],additionalProperties:false,
      properties:{from:{type:'string',pattern:'^[0-9]{8}$'},to:{type:'string',pattern:'^[0-9]{8}$'},amount:{type:'integer',minimum:1,maximum:5000},priority:{enum:['normal','urgent']},approval:{type:'string',pattern:'^APP-[0-9]{3}$'}},
      if:{properties:{priority:{const:'urgent'}},required:['priority']},then:{required:['approval']},else:{not:{required:['approval']}}}}}
  ]};
const eventRules=`顶层必须且只能有 kind、id、payload。kind 是 debit、credit、transfer 之一；id 必须是两位大写字母、一个连字符、四位数字。\n`+
  `debit 的 payload 必须有 account（恰好八位数字字符串）和 amount（1 到 5000 的整数）；可有非空 memo，不可有其他字段。\n`+
  `credit 的 payload 必须有 account、amount 和 source；account/amount 规则同上，source 只可为 cash 或 wire，不可有其他字段。\n`+
  `transfer 的 payload 必须有 from、to（各为八位数字字符串）、amount（1 到 5000 的整数）、priority（normal 或 urgent）。urgent 时还必须有符合 APP- 加三位数字的 approval；normal 时禁止 approval。其他字段禁止。`;
const E=[
  [debit(),true],[debit({amount:5000,memo:'ok'}),true],[credit(),true],[credit({source:'cash',amount:1}),true],[transfer(),true],[transfer({priority:'urgent',approval:'APP-007'}),true],
  [debit({amount:0}),false],[debit({amount:5001}),false],[debit({amount:1.5}),false],[debit({memo:''}),false],[debit({source:'cash'}),false],
  [credit({source:'card'}),false],[credit({source:undefined}),false],[transfer({priority:'urgent'}),false],[transfer({approval:'APP-123'}),false],
  [transfer({priority:'urgent',approval:'APP-12'}),false],[{...debit(),id:'ab-0123'},false],[{...debit(),other:1},false],
  [{kind:'refund',id:'AB-0123',payload:{account:acct,amount:1}},false],[{kind:'debit',id:'AB-0123'},false]
];
const reading=(sensor,level,state)=>({sensor,level,state});
const batch=(readings,patch={})=>({batchId:'BT-0042',readings,...patch});
const ok=reading('aa',0,'ok'),alert=reading('bb',7,'alert'),ok2=reading('cc',6,'ok'),alert2=reading('dd',9,'alert');
const readingSchema={type:'object',required:['sensor','level','state'],additionalProperties:false,
  properties:{sensor:{type:'string',pattern:'^[a-z]{2}$'},level:{type:'integer',minimum:0,maximum:9},state:{enum:['ok','alert']}},
  if:{properties:{state:{const:'ok'}},required:['state']},then:{properties:{level:{maximum:6}}},else:{properties:{level:{minimum:7}}}};
const alertSelector={type:'object',properties:{state:{const:'alert'}},required:['state']};
const batchSchema={$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',required:['batchId','readings'],additionalProperties:false,
  properties:{batchId:{type:'string',pattern:'^BT-[0-9]{4}$'},readings:{type:'array',minItems:2,maxItems:5,uniqueItems:true,
    items:readingSchema,contains:alertSelector,minContains:1,maxContains:2},
    tags:{type:'array',minItems:1,maxItems:3,uniqueItems:true,items:{enum:['lab','field','urgent']}}}};
const batchRules=`顶层必须有 batchId 和 readings，可有 tags，其他字段禁止。batchId 必须是 BT- 加四位数字。\n`+
  `readings 是长度 2 到 5 的数组，不可有两个完全相同的对象。每项必须且只能有 sensor、level、state：sensor 恰为两位小写字母；level 是 0 到 9 的整数；state 只能为 ok 或 alert。ok 的 level 必须在 0 到 6，alert 的 level 必须在 7 到 9。整个数组里 alert 项至少 1 项、最多 2 项。\n`+
  `tags 若存在，是长度 1 到 3 的数组，成员只能为 lab、field、urgent，成员不得重复。`;
const B=[
  [batch([ok,alert]),true],[batch([ok,alert,alert2],{tags:['lab','urgent']}),true],[batch([alert,ok2]),true],[batch([ok,alert,ok2,alert2,reading('ee',5,'ok')]),true],
  [batch([ok,ok2]),false],[batch([alert,alert2,reading('ee',8,'alert')]),false],[batch([alert]),false],
  [batch([ok,alert,ok2,alert2,reading('ee',5,'ok'),reading('ff',0,'ok')]),false],
  [batch([alert,alert]),false],[batch([reading('AA',0,'ok'),alert]),false],[batch([reading('aa',7,'ok'),alert]),false],
  [batch([ok,reading('bb',6,'alert')]),false],[batch([ok,reading('bb',7.5,'alert')]),false],
  [batch([ok,alert],{tags:[]}),false],[batch([ok,alert],{tags:['lab','lab']}),false],
  [batch([ok,alert],{tags:['other']}),false],[batch([ok,alert],{extra:true}),false],
  [{...batch([ok,alert]),batchId:'bt-0042'},false],[batch([ok,{...alert,unit:'C'}]),false],[{batchId:'BT-0042'},false]
];
const tasks=[{key:'event',rules:eventRules,cases:E,schema:eventSchema},{key:'batch',rules:batchRules,cases:B,schema:batchSchema}];
const development=[],gold=[];
for(const task of tasks){
  const cases=task.cases.map(([data,valid])=>({data,valid}));
  const validIds=cases.flatMap((c,i)=>c.valid?[String(i+1).padStart(2,'0')]:[]);
  const pairId=`SYN7-${task.key.toUpperCase()}`;
  const baseSchema={type:'object',properties:{validIds:{type:'array',items:{type:'string',pattern:'^[0-9]{2}$'},uniqueItems:true}},required:['validIds'],additionalProperties:false};
  const base={id:`${pairId}-BASE`,dimension:'structured_output',category:'schema_behavior_pair',difficulty:'unverified',language:'json',locale:'zh-CN',status:'valid',tier:'private_validation',
    promptTemplate:`判断每个样本是否符合以下规则。只输出一个 JSON 对象，validIds 为有效样本的两位编号数组，按编号升序排列。不要解释。\n\n规则：\n${task.rules}\n\n样本：\n${cases.map((c,i)=>`${String(i+1).padStart(2,'0')}: ${JSON.stringify(c.data)}`).join('\n')}\n\n输出 Schema：${JSON.stringify(baseSchema)}`,
    grader:'structured_contract',graderVersion:'structured_contract_v2',scenarioVersion:'1.0.0',scoring:{type:'schema_compliance'},
    requirements:{format:'json',dialect:'2020-12',schema:baseSchema,formatAssertions:true,assertions:[{pointer:'/validIds',expected:validIds,description:'All samples classified exactly'}],
      family:`schema_behavior_${task.key}_base`,pairId,pairVariant:'base',sourceGroup:task.key,output_policy:'raw_only'},outputPolicy:'raw_only',reviewStatus:'prospective_unverified',tags:['schema-behavior-paired','base']};
  const structured={...base,id:`${pairId}-STRUCTURED`,promptTemplate:`生成一份可执行的 JSON Schema 2020-12，准确表达以下所有规则。允许任何等价的标准写法；不得用外部 $ref。只输出完整 JSON Schema，不要围栏或解释。\n\n规则：\n${task.rules}`,
    requirements:{format:'json',dialect:'2020-12',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:['object','boolean']},formatAssertions:true,
      generatedSchema:{cases},family:`schema_behavior_${task.key}_structured`,pairId,pairVariant:'structured',sourceGroup:task.key,output_policy:'raw_only'},tags:['schema-behavior-paired','structured']};
  for(const [variant,s,raw] of [['base',base,JSON.stringify({validIds})],['structured',structured,JSON.stringify(task.schema)]]){
    s.scenarioHash=hashScenarioShort(s);development.push(s);gold.push({id:s.id,split:'development',pairId,variant,raw});
  }
}
const holdout=[];
const manifest={version:'structured-contract-frontier-v7-schema-behavior',status:'development-only',counts:{development:development.length,holdout:0},
  source:{method:'Local policy cases scored by generated-schema behavior, inspired by JSONSchemaBench; not official dataset items',families:tasks.map(t=>t.key)},
  hashes:{development:sha(development),holdout:sha(holdout),gold:sha(gold)},modelCalls:0};
fs.mkdirSync(root,{recursive:true});
for(const [name,value] of Object.entries({'development.json':development,'holdout.json':holdout,'gold.private.json':gold,'manifest.json':manifest}))
  fs.writeFileSync(`${root}/${name}`,JSON.stringify(value,null,2)+'\n');
console.log(JSON.stringify({root,counts:manifest.counts,hashes:manifest.hashes}));
