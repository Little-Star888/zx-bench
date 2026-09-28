// Frozen, source-grounded development candidates. No model calls or bank writes.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';

const root='data/pilots/structured-contract-frontier-v1';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const str={type:'string'},num={type:'integer'};
const rows=[],oracles={},gold=[];
function make(family,label,split,{sources,rule,expected,schema,format='json',raw,sourceGroup,scenarioVersion='1.0.0'}){
  const id=`SOC4-${family}-${label}`;
  const sourceMap=Object.fromEntries(Object.entries(sources).flatMap(([name,items])=>items.map(item=>[item.id,`${name}: ${JSON.stringify(item)}`])));
  const provenance={};
  function walk(value,path='',ids=[]){
    if(Array.isArray(value))value.forEach((part,i)=>walk(part,`${path}/${i}`,ids));
    else if(value!==null&&typeof value==='object'){
      const next=Array.isArray(value.sourceIds)?value.sourceIds:typeof value.sourceIds==='string'?value.sourceIds.split('|'):ids;
      for(const [key,part] of Object.entries(value))walk(part,`${path}/${key.replaceAll('~','~0').replaceAll('/','~1')}`,next);
    }else provenance[path]=ids;
  }
  walk(expected);
  const oracle={expected,sources:sourceMap,provenance};
  const req={format,dialect:'2020-12',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',...schema},
    formatAssertions:true,family:`frontier_${family}`,challengeFamily:family,sourceGroup,output_policy:'raw_only',
    oracleRef:id,oracleHash:sha(oracle),provenance:{sourcePack:'structured-contract-frontier-v1',sourceGroup,
      method:'Locally authored business fixture and JSON Schema 2020-12; source records are frozen in the prompt'}};
  const rendered=Object.entries(sources).map(([name,items])=>`${name}：\n${items.map(item=>`[${item.id}] ${JSON.stringify(item)}`).join('\n')}`).join('\n');
  const prompt=`${rule}\n${rendered}\n${format==='json'?`输出必须满足 JSON Schema 2020-12：${JSON.stringify(req.schema)}\n`:''}`
    +`只输出完整 ${format.toUpperCase()} 原文，无代码围栏和解释。sourceIds 是本行参与计算的指定来源记录 ID；即使高优先级规则覆盖其中的值，也须按本题规定的顺序列出。`;
  const scenario={id,dimension:'structured_output',category:`frontier_${family}`,difficulty:'adversarial',language:format,
    locale:'zh-CN',status:'valid',tier:'private_validation',promptTemplate:prompt,grader:'structured_contract',
    graderVersion:'structured_contract_v4',scenarioVersion,scoring:{type:'schema_compliance'},requirements:req,
    outputPolicy:'raw_only',reviewStatus:'verified',goldSource:'local-derived-fixture-v1',
    goldVerifiedAt:'2026-09-26T12:00:00.000Z',tags:['structured-contract-frontier-v1',`family:${family}`,'development_only']};
  scenario.scenarioHash=hashScenarioShort(scenario);
  rows.push({split,scenario});oracles[id]=oracle;gold.push({id,split,raw:raw??JSON.stringify(expected)});
}

const aFixtures=[
  {label:'ORDER',base:[['o01','a1','sku-7',120,'open'],['o02','a2','sku-8',90,'open'],['o03','a1','sku-9',60,'open']],
    changes:[['o02',2,'cancelled',null],['o01',3,'paid',105],['o02',1,'paid',80],['o03',4,'paid',55]],
    accounts:[['a1',true],['a2',true]],products:[['sku-7','hardware'],['sku-8','service'],['sku-9','service']]},
  {label:'REFUND',base:[['r11','u7','part-A',70,'open'],['r12','u8','part-B',115,'open'],['r13','u7','part-C',40,'open']],
    changes:[['r12',6,'paid',100],['r13',5,'cancelled',null],['r11',9,'paid',65],['r12',4,'cancelled',null]],
    accounts:[['u7',true],['u8',false]],products:[['part-A','parts'],['part-B','parts'],['part-C','warranty']]},
  {label:'CASE',base:[['c01','x1','P-01',75,'open'],['c02','x2','P-02',130,'open'],['c03','x1','P-03',50,'open']],
    changes:[['c03',7,'paid',45],['c01',8,'cancelled',null],['c02',2,'paid',125],['c01',3,'paid',70]],
    accounts:[['x1',true],['x2',true]],products:[['P-01','digital'],['P-02','hardware'],['P-03','digital']]},
];
for(const [i,f] of aFixtures.entries()){
  const sources={orders:f.base.map(([orderId,account,sku,gross,state],j)=>({id:`O${i}${j}`,orderId,account,sku,gross,state})),
    revisions:f.changes.map(([orderId,revision,state,gross],j)=>({id:`R${i}${j}`,orderId,revision,state,gross})),
    accounts:f.accounts.map(([account,active],j)=>({id:`A${i}${j}`,account,active})),
    catalog:f.products.map(([sku,category],j)=>({id:`P${i}${j}`,sku,category}))};
  const expected={records:sources.orders.map(order=>{
    const change=sources.revisions.filter(x=>x.orderId===order.orderId).sort((a,b)=>b.revision-a.revision)[0];
    const account=sources.accounts.find(x=>x.account===order.account),product=sources.catalog.find(x=>x.sku===order.sku);
    const status=!account.active?'blocked':change?.state??order.state;
    return {orderId:order.orderId,status,net:['cancelled','blocked'].includes(status)?0:change?.gross??order.gross,
      category:product.category,sourceIds:[order.id,...(change?[change.id]:[]),account.id,product.id]};
  })};
  const record=obj({orderId:str,status:{enum:['open','paid','cancelled','blocked']},net:num,category:str,
    sourceIds:{type:'array',items:str,minItems:3,maxItems:4}});
  make('A',f.label,i===2?'holdout':'development',{sources,expected,schema:obj({records:{type:'array',items:record,minItems:3,maxItems:3}}),
    sourceGroup:`order-ledger-${i}`,
    rule:'整合订单、修订、账户与产品目录。对同一订单，选 revision 数值最大的修订，不按输入顺序选；若账户 inactive，最终 status=blocked 且 net=0，优先于修订；否则用修订的状态和金额。cancelled 的 net=0；其余状态 net=最终金额。保留基础订单次序和原 ID，按 SKU 匹配目录；只输出 records。每行 sourceIds 依次是基础订单、胜出的修订（若有）、账户、产品记录。'});
}

const bFixtures=[
  {label:'ACCESS',users:[['u01',true,'reader','east'],['u02',true,'editor','west'],['u03',false,'admin','east']],
    updates:[['u01',4,'editor',null],['u02',7,null,'east']],resources:[['d1','editor','east'],['d2','reader','west']],
    requests:[['q1','u01','d1'],['q2','u02','d2'],['q3','u03','d1'],['q4','u01','d2']]},
  {label:'GRANTS',users:[['a7',true,'editor','north'],['a8',true,'reader','south'],['a9',false,'admin','north']],
    updates:[['a7',5,'reader',null],['a8',8,'admin','north']],resources:[['vault','admin','north'],['blog','reader','south']],
    requests:[['p1','a7','vault'],['p2','a8','vault'],['p3','a9','blog'],['p4','a7','blog']]},
  {label:'POLICY',users:[['x1',true,'admin','blue'],['x2',true,'reader','red'],['x3',false,'editor','blue']],
    updates:[['x1',9,'reader','red'],['x2',3,'editor','blue']],resources:[['ops','editor','blue'],['feed','reader','red']],
    requests:[['z1','x1','ops'],['z2','x2','ops'],['z3','x3','feed'],['z4','x1','feed']]},
];
for(const [i,f] of bFixtures.entries()){
  const sources={users:f.users.map(([user,active,role,region],j)=>({id:`U${i}${j}`,user,active,role,region})),
    updates:f.updates.map(([user,revision,role,region],j)=>({id:`C${i}${j}`,user,revision,role,region})),
    resources:f.resources.map(([resource,minRole,region],j)=>({id:`D${i}${j}`,resource,minRole,region})),
    requests:f.requests.map(([requestId,user,resource],j)=>({id:`Q${i}${j}`,requestId,user,resource}))};
  const rank={reader:1,editor:2,admin:3};
  const expected={decisions:sources.requests.map(q=>{
    const user=sources.users.find(x=>x.user===q.user),change=sources.updates.find(x=>x.user===q.user),resource=sources.resources.find(x=>x.resource===q.resource);
    const role=change?.role??user.role,region=change?.region??user.region;
    const reason=!user.active?'inactive':region!==resource.region?'region':rank[role]<rank[resource.minRole]?'role':'allowed';
    return {requestId:q.requestId,decision:reason==='allowed'?'allow':'deny',...(reason==='allowed'?{grantId:`${role}:${resource.resource}`}:{reason}),
      sourceIds:[q.id,user.id,...(change?[change.id]:[]),resource.id]};
  })};
  const common={requestId:str,decision:{enum:['allow','deny']},sourceIds:{type:'array',items:str,minItems:3,maxItems:4}};
  const row={oneOf:[obj({...common,decision:{const:'allow'},grantId:str}),obj({...common,decision:{const:'deny'},reason:{enum:['inactive','region','role']}})]};
  make('B',f.label,i===2?'holdout':'development',{sources,expected,sourceGroup:`access-ledger-${i}`,
    schema:obj({decisions:{type:'array',items:row,minItems:4,maxItems:4}}),
    rule:'按 requests 顺序判权限。用户更新覆盖非 null 的 role/region；inactive 优先，接着区域不符，再按 reader<editor<admin 比较角色；否则允许。允许分支只含 requestId,decision=allow,grantId="最终角色:资源 ID",sourceIds；拒绝分支只含 requestId,decision=deny,reason（inactive/region/role）,sourceIds。不得泄漏另一分支字段。每行 sourceIds 依次是请求、用户、该用户的更新（若有）、资源记录。'});
}

const cFixtures=[
  {label:'MIGRATE',base:[['cache.ttl','030',true],['auth.mode','legacy',true],['log.level','info',false]],
    edits:[['rename','cache.ttl','cache.seconds'],['set','cache.seconds','045'],['enable','log.level',true],['set','auth.mode','strict']]},
  {label:'PATCH',base:[['retry.count','03',true],['api.region','east',true],['trace.flag','',false]],
    edits:[['set','retry.count','04'],['rename','api.region','api.zone'],['set','api.zone','west'],['enable','trace.flag',true]]},
  {label:'UPGRADE',base:[['session.life','060',true],['store.mode','local',true],['audit.note','',false]],
    edits:[['rename','session.life','session.seconds'],['set','session.seconds','090'],['enable','audit.note',true],['set','store.mode','remote']]},
];
for(const [i,f] of cFixtures.entries()){
  const sources={base:f.base.map(([key,value,enabled],j)=>({id:`B${i}${j}`,key,value,enabled})),
    edits:f.edits.map(([op,key,value],j)=>({id:`E${i}${j}`,op,key,value}))};
  const state=sources.base.map(x=>({key:x.key,value:x.value,enabled:x.enabled,sourceIds:[x.id]}));
  for(const edit of sources.edits){
    const item=state.find(x=>x.key===edit.key);
    if(!item)throw Error(`Invalid edit ${edit.id}`);
    if(edit.op==='rename')item.key=edit.value;
    if(edit.op==='set')item.value=edit.value;
    if(edit.op==='enable')item.enabled=edit.value;
    item.sourceIds.push(edit.id);
  }
  const expected={settings:state};
  const row=obj({key:str,value:str,enabled:{type:'boolean'},sourceIds:{type:'array',items:str,minItems:1}});
  make('C',f.label,i===2?'holdout':'development',{sources,expected,sourceGroup:`config-migration-${i}`,
    schema:obj({settings:{type:'array',items:row,minItems:3,maxItems:3}}),
    rule:'按 edits 给出的次序修改 base 配置。rename 后，后续操作查找新 key；set 保留字符串原样（包括前导零和空串）；enable 只修改布尔值。保留原配置行的顺序，输出最终 settings，每行 sourceIds 按初始记录及实际作用在该行的编辑顺序列出。'});
}

const dFixtures=[
  {label:'CSV',format:'csv',tickets:[['t01','alice','P2','open'],['t02','bob','P3','open'],['t03','cora','P1','hold']],
    changes:[['t02',5,'P1','closed'],['t01',7,'P3','hold'],['t02',3,'P2','open']],aliases:[['alice','A. Li'],['bob','B, Wu'],['cora','Cora']]},
  {label:'XML',format:'xml',tickets:[['k11','nora','P3','open'],['k12','omar','P2','hold'],['k13','peta','P1','open']],
    changes:[['k13',8,'P2','closed'],['k11',2,'P1','hold'],['k12',6,'P3','closed']],aliases:[['nora','Nora & Co'],['omar','Omar'],['peta','Peta <P>']]},
  {label:'LEDGER',format:'csv',tickets:[['v1','sue','P2','open'],['v2','tim','P1','open'],['v3','uma','P3','hold']],
    changes:[['v3',9,'P1','closed'],['v2',4,'P3','hold'],['v3',2,'P2','open']],aliases:[['sue','Sue'],['tim','Tim "T"'],['uma','Uma, U']]},
];
const csvCell=x=>/[",\r\n]/.test(x)?`"${x.replaceAll('"','""')}"`:x;
const xmlEsc=x=>x.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
for(const [i,f] of dFixtures.entries()){
  const sources={tickets:f.tickets.map(([ticket,owner,priority,state],j)=>({id:`T${i}${j}`,ticket,owner,priority,state})),
    changes:f.changes.map(([ticket,revision,priority,state],j)=>({id:`H${i}${j}`,ticket,revision,priority,state})),
    aliases:f.aliases.map(([owner,display],j)=>({id:`N${i}${j}`,owner,display}))};
  const expected=sources.tickets.map(t=>{
    const change=sources.changes.filter(x=>x.ticket===t.ticket).sort((a,b)=>b.revision-a.revision)[0];
    const alias=sources.aliases.find(x=>x.owner===t.owner);
    return {ticket:t.ticket,owner:alias.display,priority:change?.priority??t.priority,state:change?.state??t.state,
      sourceIds:[t.id,...(change?[change.id]:[]),alias.id].join('|')};
  });
  const keys=['ticket','owner','priority','state','sourceIds'];
  const raw=f.format==='csv'?[keys.join(','),...expected.map(row=>keys.map(k=>csvCell(row[k])).join(','))].join('\r\n')+'\r\n':
    `<records>${expected.map(row=>`<record>${keys.map(k=>`<${k}>${xmlEsc(row[k])}</${k}>`).join('')}</record>`).join('')}</records>`;
  make('D',f.label,i===2?'holdout':'development',{sources,expected,raw,format:f.format,scenarioVersion:'1.0.1',sourceGroup:`ticket-format-${i}`,
    schema:{type:'array',items:obj(Object.fromEntries(keys.map(k=>[k,str]))),minItems:3,maxItems:3},
    rule:`按基础 tickets 顺序合并 changes 和 aliases：同 ticket 取 revision 数值最大的修改，不按列出顺序；owner 按原 ID 查别名；sourceIds 严格只列基础 ticket、最终采用的最高 revision 修改（若有）、owner 别名记录，用 | 连接。被更高 revision 覆盖的修改不得列入 sourceIds。输出 ${f.format==='csv'?'RFC 4180 CSV，表头严格为 ticket,owner,priority,state,sourceIds；逗号和双引号须正确转义':'XML，根为 records，子元素为 record，每项按 ticket,owner,priority,state,sourceIds 顺序输出并正确转义文本'}。`});
}

fs.mkdirSync(root,{recursive:true});
const development=rows.filter(x=>x.split==='development').map(x=>x.scenario);
const holdout=rows.filter(x=>x.split==='holdout').map(x=>x.scenario);
const files={'development.json':development,'holdout.json':holdout,'oracle.private.json':oracles,
  'gold.private.json':gold,'manifest.json':{version:'structured-contract-frontier-v1.1',status:'development-only',
    counts:{development:development.length,holdout:holdout.length},
    splitPolicy:'Source records and identifiers are disjoint. Family rule templates are shared; holdout is a preliminary transfer check, not a fully independent template test.',
    sourceSchemaNote:'JSON Schema 2020-12 constraints are locally authored. They are not copied or claimed as official SchemaBench items.',
    hashes:{development:sha(development),holdout:sha(holdout),oracle:sha(oracles),gold:sha(gold)},modelCalls:0}};
for(const [name,value] of Object.entries(files))fs.writeFileSync(`${root}/${name}`,JSON.stringify(value,null,2)+'\n');
console.log(JSON.stringify({development:development.length,holdout:holdout.length,ids:rows.map(x=>x.scenario.id)}));
