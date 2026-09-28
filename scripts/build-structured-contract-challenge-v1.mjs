// Fourteen deterministic, source-derived tasks. Gold is generated separately
// from the prompt and each task has a targeted plausible defect.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';

const root='data/pilots/structured-contract-challenge-v1';
const d20='https://json-schema.org/draft/2020-12/schema';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const clone=x=>structuredClone(x);
const obj=(props,required=Object.keys(props))=>({type:'object',properties:props,required,additionalProperties:false});
const str={type:'string'},bool={type:'boolean'},integer={type:'integer'};
const pack=[],gold=[];
function add(family,name,{prompt,format='json',schema,expected,negative,raw,requirements={},sourceGroup}){
  const id=`SOC3-${family}-${name}`;
  const escapePointer=x=>String(x).replaceAll('~','~0').replaceAll('/','~1');
  const contentChecks=expected===undefined?[]:[
    {pointer:'',expected,description:'Entire public transformation, including absence of extra data'},
    ...Object.entries(expected).map(([key,value])=>({pointer:`/${escapePointer(key)}`,expected:value,
      description:`Public rule group ${key} preserves exact type, value, and ordering`})),
  ];
  const req={format,dialect:'2020-12',schema:typeof schema==='boolean'?schema:{$schema:d20,...schema},formatAssertions:true,family,output_policy:'raw_only',
    ...(contentChecks.length?{assertions:contentChecks}:{}),
    ...requirements,provenance:{sourceGroup,sourcePack:'structured-contract-challenge-v1',method:'Independent local task construction; no official item copied'}};
  const instruction=`${prompt}\n${format==='json'?`输出须满足 JSON Schema：${JSON.stringify(req.schema)}\n`:''}只输出一个完整 ${format.toUpperCase()} 原文，不要代码围栏、解释或修复性前后缀。对象键序不限。`;
  const scenario={id,dimension:'structured_output',category:`contract_challenge_${family}`,difficulty:'adversarial',language:format,locale:'zh-CN',status:'valid',tier:'private_validation',
    promptTemplate:instruction,grader:'structured_contract',graderVersion:requirements.generatedSchema?'structured_contract_v3':'structured_contract_v2',
    scenarioVersion:'1.0.0',scoring:{type:'schema_compliance'},requirements:req,outputPolicy:'raw_only',reviewStatus:'verified',
    goldSource:'local-derived-fixture-v1',goldVerifiedAt:'2026-09-26T12:00:00.000Z',tags:['structured-contract-challenge-v1',`family:${family}`,'prospective_only']};
  scenario.scenarioHash=hashScenarioShort(scenario);pack.push(scenario);
  gold.push({id,sourceGroup,raw:raw??JSON.stringify(expected),negative:typeof negative==='string'?negative:JSON.stringify(negative),expected});
}

// A: interacting conditional permissions and account state. Source data is in
// the prompt, while the oracle is computed from rules rather than a copied table.
for(const [name,accounts,requests] of [
  ['POLICY',[{id:'07',active:true,roles:['reader','editor'],deny:['write:sealed']},{id:'08',active:false,roles:['admin'],deny:[]},{id:'09',active:true,roles:['reader'],deny:[]}],
    [{id:'r1',account:'07',scope:'read:open'},{id:'r2',account:'07',scope:'write:sealed'},{id:'r3',account:'08',scope:'delete:open'},{id:'r4',account:'09',scope:'write:open'},{id:'r5',account:'09',scope:'read:sealed'}]],
  ['ROUTE',[{id:'00',active:true,roles:['operator'],deny:[]},{id:'11',active:true,roles:['reader','operator'],deny:['deploy:prod']},{id:'12',active:false,roles:['admin'],deny:[]}],
    [{id:'q1',account:'00',scope:'deploy:dev'},{id:'q2',account:'00',scope:'deploy:prod'},{id:'q3',account:'11',scope:'deploy:prod'},{id:'q4',account:'11',scope:'read:prod'},{id:'q5',account:'12',scope:'read:dev'}]]
]){
  const grants={reader:['read'],editor:['write'],operator:['deploy'],admin:['read','write','delete','deploy']};
  const rows=requests.map(r=>{const a=accounts.find(x=>x.id===r.account),verb=r.scope.split(':')[0];
    const reason=!a.active?'inactive':a.deny.includes(r.scope)?'denied':a.roles.some(role=>grants[role].includes(verb))?'allowed':'missing_role';
    return {id:r.id,account:r.account,scope:r.scope,decision:reason==='allowed'?'allow':'deny',reason};});
  const decisions=obj({id:str,account:str,scope:str,decision:{enum:['allow','deny']},reason:{enum:['inactive','denied','allowed','missing_role']}});
  const schema=obj({results:{type:'array',items:decisions,minItems:5,maxItems:5},allowedCount:integer,deniedCount:integer});
  const expected={results:rows,allowedCount:rows.filter(x=>x.decision==='allow').length,deniedCount:rows.filter(x=>x.decision==='deny').length};
  const negative=clone(expected);negative.results[2].decision='allow';
  add('A',name,{sourceGroup:`policy:${name}`,schema,expected,negative,
    prompt:`按请求顺序生成权限裁决。role 授权动词：reader→read，editor→write，operator→deploy，admin→read/write/delete/deploy。只看 scope 冒号前的动词；后缀必须完整保留。按以下优先级给 reason：inactive 先于 denied（deny 列表完整匹配 scope），然后有角色授权为 allowed，否则 missing_role。只有 allowed 的 decision 为 allow，其他均为 deny。输出 results、allowedCount、deniedCount，计数必须与结果相符。前导零的 id 保持字符串。\n账户：${JSON.stringify(accounts)}\n请求：${JSON.stringify(requests)}`});
}

// B: ordered edits on a recursive tree. The schema checks tree shape; the
// content oracle checks all retained siblings, nulls, and edit ordering.
for(const [name,input,operations] of [
  ['TREE',{id:'root',children:[{id:'a',value:'007',children:[{id:'a1',value:null},{id:'a2',value:'x'}]},{id:'b',value:'keep',children:[{id:'b1',value:'old'}]}]},
    [{op:'move',from:'a/a2',to:'b',index:0},{op:'set',id:'b/b1',value:''},{op:'delete',id:'a/a1'}]],
  ['FOREST',{id:'root',children:[{id:'left',value:'0',children:[{id:'leaf',value:'L'}]},{id:'right',value:null,children:[{id:'r0',value:'R0'},{id:'r1',value:'R1'}]}]},
    [{op:'move',from:'right/r0',to:'left',index:1},{op:'delete',id:'right/r1'},{op:'set',id:'left/leaf',value:'L\nR'}]]
]){
  const output=clone(input);
  const get=path=>path.split('/').reduce((node,id)=>id==='root'?node:node.children.find(x=>x.id===id),output);
  for(const step of operations){
    if(step.op==='set')get(step.id).value=step.value;
    else if(step.op==='delete'){const parts=step.id.split('/'),parent=get(parts.slice(0,-1).join('/'));parent.children.splice(parent.children.findIndex(x=>x.id===parts.at(-1)),1);}
    else{const parts=step.from.split('/'),parent=get(parts.slice(0,-1).join('/'));const [moving]=parent.children.splice(parent.children.findIndex(x=>x.id===parts.at(-1)),1);get(step.to).children.splice(step.index,0,moving);}
  }
  const schema={$defs:{node:{type:'object',properties:{id:str,value:{type:['string','null']},children:{type:'array',items:{$ref:'#/$defs/node'}}},required:['id'],additionalProperties:false}},$ref:'#/$defs/node'};
  const negative=clone(output);negative.children[1].value='wrong';
  add('B',name,{sourceGroup:`tree-edit:${name}`,schema,expected:output,negative,
    prompt:`按列出的顺序编辑树并输出完整最终树。路径由 id 用 / 分隔，首段为 root；move 是从原父节点删除整个子树，再插入目标节点 children 的指定 0 基索引，随后索引立即重排；set 只改 value；delete 删除整个子树。其余节点、字段、null/空串与兄弟次序原样保留；不要写操作日志。\n输入：${JSON.stringify(input)}\n操作：${JSON.stringify(operations)}`});
}

// C: preserve raw text while deriving normalized, encoded, and pointer keys.
for(const [name,source] of [
  ['UNICODE',[{id:'001',text:'Cafe\u0301/猫~',enabled:false},{id:'002',text:'%25+\r\n',enabled:true},{id:'003',text:null,enabled:false}]],
  ['PATH',[{id:'010',text:'e\u0301/甲',enabled:true},{id:'011',text:'a~b/c',enabled:false},{id:'012',text:'',enabled:true}]]
]){
  const rows=source.map(x=>x.text===null?{id:x.id,enabled:x.enabled,present:false}:
    {id:x.id,enabled:x.enabled,present:true,raw:x.text,nfc:x.text.normalize('NFC'),pointerKey:x.text.replaceAll('~','~0').replaceAll('/','~1'),
      bytes:Buffer.from(x.text.normalize('NFC'),'utf8').toString('base64url')});
  const row=obj({id:{type:'string',pattern:'^0[0-9]{2}$'},enabled:bool,present:bool,raw:str,nfc:str,pointerKey:str,bytes:{type:'string',pattern:'^[A-Za-z0-9_-]*$'}},['id','enabled','present']);
  const schema={type:'array',items:{...row,allOf:[{if:{properties:{present:{const:true}},required:['present']},then:{required:['raw','nfc','pointerKey','bytes']},else:{not:{anyOf:[{required:['raw']},{required:['nfc']},{required:['pointerKey']},{required:['bytes']}]}}}]},minItems:3,maxItems:3};
  const negative=clone(rows);negative[0].raw=negative[0].nfc;
  if(negative[0].raw===rows[0].raw)negative[1].pointerKey='unescaped';
  add('C',name,{sourceGroup:`unicode:${name}`,schema,expected:rows,negative,
    prompt:`按输入顺序处理每项。id 和 enabled 原样保留，text 为 null 时 present=false 且必须省略 raw/nfc/pointerKey/bytes；其他情况 present=true，raw 保存原码点序列，nfc 是 NFC 规范化结果，pointerKey 对原始 raw 按 RFC 6901 逐字替换 ~→~0、/→~1，bytes 是 nfc 的 UTF-8 Base64URL 无填充编码。空串不是 null，不能省略。输入：${JSON.stringify(source)}`});
}

// E: same fixed event log into a simple projection and a conditional ledger.
const events=[{id:'a',kind:'open',amount:0,note:''},{id:'b',kind:'charge',amount:7,note:'x\\y'},
  {id:'c',kind:'charge',amount:4,note:'\n'},{id:'d',kind:'refund',amount:3,note:null},{id:'e',kind:'close',amount:0,note:''}];
for(const [name,complex] of [['SIMPLE',false],['LEDGER',true]]){
  let balance=0;const rows=events.map((e,i)=>{
    if(e.kind==='charge')balance+=e.amount;if(e.kind==='refund')balance-=e.amount;
    return complex?{seq:i+1,id:e.id,entry:e.kind==='charge'?{charge:{amount:e.amount,note:e.note}}:
      e.kind==='refund'?{refund:{amount:e.amount,note:e.note}}:{[e.kind]:true},balance}:
      {id:e.id,kind:e.kind,amount:e.amount,note:e.note};
  });
  const expected=complex?{entries:rows,finalBalance:balance}:rows;
  const negative=clone(expected);if(complex)negative.entries[3].balance++;else negative[1].note='xy';
  const schema=complex?obj({entries:{type:'array',minItems:5,maxItems:5,items:obj({seq:integer,id:str,entry:{type:'object',minProperties:1,maxProperties:1},balance:integer})},finalBalance:integer}):
    {type:'array',minItems:5,maxItems:5,items:obj({id:str,kind:{enum:['open','charge','refund','close']},amount:integer,note:{type:['string','null']}})};
  add('E',name,{sourceGroup:'event-ledger:paired',schema,expected,negative,
    prompt:`给定同一事件流，按原顺序输出${complex?'完整账本对象：entries 每条 seq 从 1 起、id 原样；open/close 的 entry 分别只含 {open:true}/{close:true}，charge/refund 的 entry 分别只含 {charge:{amount,note}}/{refund:{amount,note}}；balance 从 0 起，charge 加、refund 减，open/close 不变；finalBalance 为最后余额':'原样投影数组：每项仅保留 id、kind、amount、note，含空串和 null'}。不得丢项或合并金额。输入：${JSON.stringify(events)}`});
}

// F: nested source flattening; quoted CSV and XML attribute/null rules.
const groups=[{actor:'A/01',events:[{code:'007',note:'a,"b"\n尾'},{code:'008',note:''}]},
  {actor:'B~02',events:[{code:'010',note:'ON'},{code:'011',note:null}]}];
const flat=groups.flatMap(g=>g.events.map((e,i)=>({actor:g.actor,index:String(i),code:e.code,note:e.note})));
const csvRows=flat.map(({actor,index,code,note})=>({actor,index,code,note:note===null?'<NULL>':note}));
const csvCell=x=>/[",\r\n]/.test(x)?`"${x.replaceAll('"','""')}"`:x;
const csv=['actor,index,code,note',...csvRows.map(x=>[x.actor,x.index,x.code,x.note].map(csvCell).join(','))].join('\r\n')+'\r\n';
const csvNegative=csv.replace('"a,""b""\n尾"','"a,""b""\\n尾"');
add('F','CSV',{sourceGroup:'nested-conversion:csv',format:'csv',schema:{type:'array',minItems:4,maxItems:4,items:obj({actor:str,index:str,code:str,note:str})},
  expected:csvRows,raw:csv,negative:csvNegative,
  prompt:`把嵌套输入展平为 CSV。首行表头恰为 actor,index,code,note；逐组、组内原顺序，每条记录的 actor 取组名，index 是组内 0 基序号的十进制字符串。code 保持前导零。note 为 null 时写字面量 <NULL>，空串仍为空串；字段内实际换行必须保持实际换行，按 RFC 4180 引号转义。输入：${JSON.stringify(groups)}`});
const esc=x=>x.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const xml=`<records>${flat.map(x=>`<record><actor>${esc(x.actor)}</actor><index>${x.index}</index><code>${x.code}</code>${x.note===null?'<note null="true"/>':`<note>${esc(x.note)}</note>`}</record>`).join('')}</records>`;
const xmlNegative=xml.replace('<note null="true"/>','<note/>');
add('F','XML',{sourceGroup:'nested-conversion:xml',format:'xml',schema:{type:'array',minItems:4,maxItems:4,items:obj({actor:str,index:str,code:str,note:{type:['string','null']}})},
  expected:flat,raw:xml,negative:xmlNegative,
  prompt:`把嵌套输入展平为 XML。根元素 records，依次是 record；每条 record 子元素顺序严格为 actor,index,code,note。index 是组内 0 基序号的十进制字符串，code 保留前导零，文本按 XML 正确转义。note=null 用空元素 <note null="true"/>，空串用不带属性的空 note 元素。禁止 DTD、实体声明、额外属性或嵌套字段。输入：${JSON.stringify(groups)}`});

// G: schemas are evaluated by behavior, not textual similarity. Each case
// targets a separate boundary; positives include multiple non-template forms.
function schemaTask(name,description,cases,answer){
  const negative=clone(answer);
  if(name==='ARRAY')negative.maxItems=5;
  else negative.additionalProperties=true;
  add('G',name,{sourceGroup:`schema-behavior:${name}`,schema:{type:['object','boolean']},raw:JSON.stringify(answer),negative,
    requirements:{generatedSchema:{cases}},prompt:`生成 JSON Schema 2020-12，准确表达以下全部规则。允许任何等价的标准 Schema 写法，不要求与参考答案文本相同。只允许本地 $ref，Schema 深度最多 64，禁止外部资源。\n${description}`});
}
const objectCases=[];
const positiveObject=[{kind:'token',id:'00',auth:{token:'x'}},{kind:'token',id:'09',auth:{token:'a/b'}},
  {kind:'pair',id:'11',auth:{user:'',password:''}},{kind:'pair',id:'99',auth:{user:'u',password:'p'}}];
for(const x of positiveObject)objectCases.push({data:x,valid:true});
for(const x of [{},{kind:'token',id:'00',auth:{token:''}},{kind:'pair',id:'01',auth:{user:'u'}},
  {kind:'token',id:'1',auth:{token:'x'}},{kind:'pair',id:'11',auth:{user:'u',password:'p',extra:0}},
  {kind:'token',id:'00',auth:{user:'u',password:'p'}},{kind:'pair',id:'11',auth:{token:'x'}},
  {kind:'token',id:'00',auth:{token:'x'},extra:1},{kind:'pair',id:'11',auth:{user:null,password:'p'}},
  {kind:'token',id:'00',auth:{token:'x',user:'u'}},null,[]])objectCases.push({data:x,valid:false});
schemaTask('AUTH',`顶层恰有 kind、id、auth，kind 为 token 或 pair；id 是两位十进制字符串。kind=token 时 auth 恰有一个非空字符串 token；kind=pair 时 auth 恰有字符串 user、password，二者可空。其他键禁止。`,objectCases,
  {$schema:d20,type:'object',properties:{kind:{enum:['token','pair']},id:{type:'string',pattern:'^[0-9]{2}$'},auth:{type:'object'}},required:['kind','id','auth'],additionalProperties:false,
    allOf:[{if:{properties:{kind:{const:'token'}},required:['kind']},then:{properties:{auth:obj({token:{type:'string',minLength:1}})}},else:{properties:{auth:obj({user:str,password:str})}}}]});
const tupleCases=[];
for(const data of [[{key:'a',value:0},{key:'b',value:2}],[{key:'x',value:3},{key:'y',value:1},{key:'z',value:0}],
  [{key:'a',value:1},{key:'b',value:1},{key:'c',value:1},{key:'d',value:1}],
  [{key:'a',value:1},{key:'a',value:2}]])tupleCases.push({data,valid:true});
for(const data of [[],[{key:'a',value:1}],[{key:'a',value:3},{key:'b',value:1}],
  [{key:'a',value:-1},{key:'b',value:2}],[{key:'a',value:4},{key:'b',value:0}],
  [{key:'a',value:1},{key:'b',value:1,extra:0}],[{key:'a',value:1},{key:'b',value:1},{key:'c',value:1},{key:'d',value:1},{key:'e',value:1}],
  [{key:'A',value:1},{key:'b',value:1}],[{key:'a',value:1},{key:'b',value:1},null],{},null])tupleCases.push({data,valid:false});
// This question uses explicit prefix keys to make cross-item uniqueness a
// standard JSON Schema assertion rather than an unenforceable natural-language rule.
const keyPattern='^[a-z]$';
const tupleSchema={$schema:d20,type:'array',minItems:2,maxItems:4,items:obj({key:{type:'string',pattern:keyPattern},value:{type:'integer',minimum:0,maximum:3}}),
  allOf:[{not:{contains:{properties:{key:{const:'a'},value:{const:3}},required:['key','value']}}}]};
// Duplicate keys are permitted in different array elements; only the
// explicitly forbidden key/value combination is rejected.
schemaTask('ARRAY',`顶层是长度 2 至 4 的数组，每项恰含 key 与 value。key 是单个小写英文字母；value 是 0 至 3 的整数。同一 key 可重复。整个数组中不能出现 key="a" 且 value=3 的项目。其他键禁止。`,tupleCases,tupleSchema);

// H: visible geometry derived from data; element identifiers and pixels are
// scored independently of whether the SVG text resembles the fixture.
for(const [name,values,labels] of [['BARS',[3,5,2],['A&B','C< D','E']],['DELTA',[4,1,6],['甲/乙','x~y','z']]]){
  const width=240,height=140,colors=['#e4572e','#3a86ff','#2a9d8f'];
  const elements=values.map((v,i)=>({id:`bar/${i}`,tag:'rect',attrs:{x:20+i*70,y:110-v*12,width:36,height:v*12}}));
  elements.push(...labels.map((label,i)=>({id:`label/${i}`,tag:'text',attrs:{x:20+i*70,y:130},text:label})));
  const nodes=Object.fromEntries(elements.map(e=>[e.id,{tag:e.tag,attrs:e.attrs,...(e.text!==undefined?{text:e.text}:{})}]));
  const expected={width,height,viewBox:[0,0,width,height],nodes};
  const samples=values.map((v,i)=>({x:25+i*70,y:105,rgba:[...Buffer.from(colors[i].slice(1),'hex'),255]}));
  const escapeXml=x=>x.replaceAll('&','&amp;').replaceAll('<','&lt;');
  const raw=`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140">${values.map((v,i)=>`<rect id="bar/${i}" x="${20+i*70}" y="${110-v*12}" width="36" height="${v*12}" fill="${colors[i]}"/>`).join('')}${labels.map((t,i)=>`<text id="label/${i}" x="${20+i*70}" y="130">${escapeXml(t)}</text>`).join('')}</svg>`;
  const negative=raw.replace(colors[1],'#000000');
  add('H',name,{sourceGroup:`svg-derived:${name}`,format:'svg',schema:obj({width:integer,height:integer,viewBox:{type:'array',minItems:4,maxItems:4,items:integer},nodes:{type:'object'}}),
    expected,raw,negative,requirements:{svg:{width,height,elements,samples}},
    prompt:`根据数值生成可见柱状 SVG。画布 width=240、height=140、viewBox="0 0 240 140"。每个索引 i=0,1,2 的 rect id="bar/i"：x=20+70*i，y=110-12*value，width=36，height=12*value，填充色依次为 ${colors.join('、')}；其柱体在这些坐标实际可见，不得透明或遮挡。text id="label/i"：x=20+70*i、y=130，文字是对应 label 原文，正确 XML 转义。允许等价颜色写法；禁止脚本、样式表、动画、foreignObject、外部资源与 DTD。\n数据：${JSON.stringify(values.map((value,i)=>({value,label:labels[i]})))}`});
}

if(pack.length!==14||new Set(pack.map(s=>s.id)).size!==14)throw Error('Expected fourteen distinct candidates');
fs.mkdirSync(root,{recursive:true});
const files={development:pack,gold};
for(const [name,value] of Object.entries(files))fs.writeFileSync(`${root}/${name}.json`,JSON.stringify(value,null,2)+'\n');
const manifest={version:'structured-contract-challenge-v1',status:'frozen-unmeasured',count:pack.length,
  sourceGroups:[...new Set(gold.map(g=>g.sourceGroup))],hashes:Object.fromEntries(Object.entries(files).map(([name,value])=>[name,sha(value)])),
  gradePolicy:'Complete success iff raw format, published JSON Schema, all source-derived content checks, and rendering/behavior if applicable pass.',
  difficultyClaim:'Prospective challenge design only; no measured discrimination on these new prompts.',modelCalls:0};
fs.writeFileSync(`${root}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({count:pack.length,hashes:manifest.hashes}));
