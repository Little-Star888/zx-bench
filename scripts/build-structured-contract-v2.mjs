import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';
const root='data/pilots/structured-contract-v2';fs.mkdirSync(root,{recursive:true});
const packs={development:[],holdout:[]},gold={development:[],holdout:[]};
const old=JSON.parse(fs.readFileSync('data/pilots/structured-contract-v1/development.json'));
const clone=x=>structuredClone(x),sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const str={type:'string'},bool={type:'boolean'},integer={type:'integer'};
const d7='http://json-schema.org/draft-07/schema#',d20='https://json-schema.org/draft/2020-12/schema';
function add(split,family,name,{schema=true,expected,prompt,format='json',raw,negative,requirements={},sourceGroup,source=null,pairId=null}){
 const id=`SOC2-${family}-${split==='development'?'D':'H'}-${name}`;
 const req={format,dialect:'2020-12',schema:typeof schema==='boolean'?schema:{$schema:d20,...schema},formatAssertions:true,family,output_policy:'raw_only',
   ...(expected!==undefined?{assertions:[{pointer:'',expected,description:'Preserve the publicly specified data and transformation'}]}:{}),...requirements,
   developmentShadow:true,provenance:{sourceGroup:sourceGroup??`authored:${family}:${split}`,source,pairId,split,seed:id,
     method:'Locally authored composition/conversion task; not an official benchmark instance'}};
 const suffix=format==='json'?`\n输出必须遵循这个 Schema：${JSON.stringify(req.schema)}`:'';
 const s={id,dimension:'structured_output',category:`contract_${family}`,difficulty:'medium',language:format,locale:'zh-CN',status:'valid',tier:'private_dev',
   grader:'structured_contract',graderVersion:'structured_contract_v2',scenarioVersion:'1.0.0',scoring:{type:'schema_compliance'},
   promptTemplate:`${prompt}${suffix}\n只输出完整 ${format.toUpperCase()} 原文，不要围栏或解释。对象键序不限。响应最多 131072 个字符。`,
   requirements:req,outputPolicy:'raw_only',reviewStatus:'unreviewed',goldSource:'frozen-derived-fixture-v2',tags:['structured-contract-v2',`family:${family}`,`split:${split}`]};
 const frozen=JSON.parse(JSON.stringify(s));frozen.scenarioHash=hashScenarioShort(frozen);packs[split].push(frozen);
 gold[split].push({id,sourceGroup:req.provenance.sourceGroup,raw:raw??JSON.stringify(expected),negative,expected});
}

// A: real workflow step definitions plus interacting, explicitly supplied 2020-12 rules.
for(const [i,env] of ['prod','dev'].entries()){
 const original=old.find(x=>x.id==='SOC-A-D3'),defs=clone(original.requirements.schema.definitions);
 const rows=[{id:'checkout',type:'action',target:'actions/checkout@v4',args:{'fetch-depth':0}},
   {id:'verify',type:'shell',target:'printf "a\\nb"',cwd:'src/目录',shell:'bash'},
   {id:'publish',type:'action',target:'example/publish@v2',args:{dryRun:env==='dev',token:'${{ secrets.PUBLISH }}'}}];
 const steps=rows.map(r=>r.type==='action'?{id:r.id,uses:r.target,with:r.args}:{id:r.id,run:r.target,'working-directory':r.cwd,shell:r.shell});
 const schema={type:'object',properties:{environment:{enum:['prod','dev']},steps:{type:'array',minItems:3,maxItems:3,items:{$ref:'#/definitions/step'}},cache:bool},required:['environment','steps','cache'],
   allOf:[{if:{properties:{environment:{const:'prod'}},required:['environment']},then:{properties:{approval:obj({team:{const:'ops'},timeout:{const:0}}),permissions:obj({contents:{const:'read'},packages:{const:'write'}})},required:['approval','permissions']},else:{properties:{permissions:obj({contents:{const:'read'}})},required:['permissions'],not:{required:['approval']}}},
     {if:{properties:{cache:{const:true}},required:['cache']},then:{properties:{cacheKey:{type:'string',pattern:'^build/[a-z]+~v2$'}},required:['cacheKey']},else:{not:{required:['cacheKey']}}}],
   dependentRequired:{approval:['permissions']},unevaluatedProperties:false,definitions:defs};
 const expected={environment:env,steps,cache:!i,...(!i?{cacheKey:'build/prod~v2',approval:{team:'ops',timeout:0},permissions:{contents:'read',packages:'write'}}:{permissions:{contents:'read'}})};
 const bad=clone(expected);bad.approval={team:'ops',timeout:1};
 add('development','A',String(i+1),{schema,expected,negative:JSON.stringify(bad),sourceGroup:'schemastore:github-workflow',source:original.requirements.provenance,
  prompt:`把输入步骤转换为配置。environment=${env}，cache=${!i}。action 行把 target→uses、args→with；shell 行把 target→run、cwd→working-directory；保留 id、shell；其余源字段删除。步骤及值保持顺序/原类型。其余顶层字段按 Schema 的条件分支生成：有 cacheKey 时为 build/${env}~v2。必须使用 schema 中声明的具体值，包括 0 和 false。输入：${JSON.stringify(rows)}`});
}
const routeSchema={type:'object',properties:{mode:{enum:['public','private']},host:str,auth:obj({scheme:{const:'mtls'},ca:str}),ports:{type:'array',items:integer,minItems:1,uniqueItems:true}},required:['mode','host','ports'],
 allOf:[{if:{properties:{mode:{const:'private'}},required:['mode']},then:{required:['auth']},else:{not:{required:['auth']}}}],unevaluatedProperties:false};
add('holdout','A','route',{schema:routeSchema,expected:{mode:'private',host:'svc.internal',ports:[443,8443],auth:{scheme:'mtls',ca:'ca/内网.pem'}},negative:'{"mode":"public","host":"svc.internal","ports":[443],"auth":{"scheme":"mtls","ca":"ca/内网.pem"}}',
 prompt:'生成网关路由。mode=private；host=svc.internal；ports 按顺序为 443、8443；如果 schema 要求 auth，则 scheme=mtls，ca=ca/内网.pem。不得遗漏 Schema 条件字段。'});

// B: preserve recursive exports while applying ordered structural edits (no arithmetic task).
for(let i=0;i<2;i++){
 const original=old.find(x=>x.id==='SOC-B-D3'),schema=clone(original.requirements.schema);schema.$schema=d7;
 const base={node:{import:'./a.mjs',require:'./a.cjs'},browser:{development:{default:['./dev.js',null,'./last.js']}},default:'./fallback.js'};
 const expected=i?{node:{import:'./a.mjs',require:'./a.cjs'},browser:{development:{default:[null,'./last.js']},production:{default:'./a.mjs'}},default:'./fallback.js'}
 :{node:{import:'./a.mjs',require:['./shim.cjs','./a.cjs']},browser:{development:{default:['./last.js','./dev.js',null]}},default:null};
 const operations=i?'①删除 browser.development.default 数组索引 0；②读取 node.import 的当前字符串复制到 browser.production.default（创建缺失的中间对象）；③保留其余节点。'
 :'①把 browser.development.default 最后一个元素移动至索引 0，其余元素相对顺序不变；②把 node.require 的原字符串改为数组 ["./shim.cjs",原字符串]；③把 default 改为 null，但不能删除此键。';
 add('development','B',String(i+1),{schema,requirements:{dialect:'draft-07'},expected,negative:JSON.stringify(base),sourceGroup:'schemastore:package',source:original.requirements.provenance,
 prompt:`按顺序执行结构编辑并输出最终 npm exports 对象。路径中的点表示对象层级。数组索引从 0 起，移动/删除后立即重排。${operations} 输入：${JSON.stringify(base)}`});
}
const treeDef={oneOf:[obj({kind:{const:'leaf'},name:str,value:{type:['string','null']}}),obj({kind:{const:'group'},name:str,children:{type:'array',items:{$ref:'#/$defs/node'}}})]};
const tree={kind:'group',name:'根',children:[{kind:'leaf',name:'a/b~c',value:null},{kind:'group',name:'nested',children:[{kind:'leaf',name:'empty',value:''}]}]};
add('holdout','B','tree',{schema:{$ref:'#/$defs/node',$defs:{node:treeDef}},expected:tree,negative:JSON.stringify({...tree,children:[]}),
 prompt:'生成递归树，根是 group，name="根"。根的第一个孩子是 leaf，name="a/b~c"，value=null；第二个是 group，name="nested"，它恰有一个 leaf 孩子，name="empty"，value=""。保留 null 和空串，禁止简化树。'});

// C: description-only normalization with reversible encoding and falsey values.
for(let i=0;i<2;i++){
 const input=[{id:'007',note:i?'a/b~c\r\n"x"':'Cafe\u0301/路径',enabled:false},{id:'010',note:'',enabled:true},{id:'011',note:null,enabled:false}];
 const expected=input.map(x=>({id:x.id,enabled:x.enabled,...(x.note===null?{}:{original:x.note,encoded:Buffer.from(x.note.normalize('NFC')).toString('base64url')})}));
 const schema={type:'array',items:{type:'object',properties:{id:{type:'string',pattern:'^0[0-9]{2}$'},enabled:bool,original:str,encoded:{type:'string',pattern:'^[A-Za-z0-9_-]*$'}},required:['id','enabled'],dependentRequired:{original:['encoded'],encoded:['original']},additionalProperties:false}};
 const bad=clone(expected);delete bad[0].enabled;
 add('development','C',String(i+1),{schema,expected,negative:JSON.stringify(bad),prompt:`按输入顺序输出数组。id 必须保留前导零和字符串类型；enabled 原样保留，包括 false。note 为 null 时省略 original、encoded；否则 original 保存未经规范化的原 note，encoded 保存 note 先 NFC 规范化、再 UTF-8、再 Base64URL 编码的结果（用 -_ 替代 +/，去掉尾部 =）。空串必须保留。不要给 original 做 NFC 规范化。输入：${JSON.stringify(input)}`});
}
add('holdout','C','headers',{schema:obj({headers:obj({'x-note':str,'x-empty':str,'x-enabled':bool})}),expected:{headers:{'x-note':'a%2Fb%20%E7%A9%BA','x-empty':'','x-enabled':false}},negative:'{"headers":{"x-note":"a/b 空","x-empty":"","x-enabled":false}}',
 prompt:'生成 headers 对象，只有 x-note、x-empty、x-enabled。x-note 对字符串 "a/b 空" 按 UTF-8 百分号编码：仅 ASCII 字母数字和 -._~ 不编码，十六进制大写，空格是 %20；x-empty 是空串；x-enabled 是布尔 false。'});

// D: immutable prior tasks; exact hashes permit zero-call replay of the three saved outputs.
for(const split of ['development','holdout']){
 const previous=JSON.parse(fs.readFileSync(`data/pilots/structured-contract-v1/${split}.json`));
 const previousGold=JSON.parse(fs.readFileSync(`data/pilots/structured-contract-v1/${split}-gold.json`));
 for(const s of previous.filter(s=>s.requirements.family==='D')){packs[split].push(s);const g=previousGold.find(g=>g.id===s.id);gold[split].push({...g,raw:JSON.stringify(g.expected),negative:JSON.stringify(g.negative)});}
}

// E: same content, two output contracts, both kept in the same source-group split.
for(const split of ['development','holdout']){
 if(split==='holdout'){
  const input=[{id:'02',role:'guest',token:null},{id:'03',role:'member',token:''},{id:'04',role:'admin',token:'a~b'}];
  const pairId='pair:E:holdout',sourceGroup='authored:permissions';
  add(split,'E','simple',{schema:true,expected:input,negative:'[]',pairId,sourceGroup,prompt:`把输入账户列表按原顺序输出；字段、值及类型不变。输入：${JSON.stringify(input)}`});
  const expected={grants:{'02':[],'03':['read'],'04':['read','write']},credentials:{'03':'','04':'a~b'}};
  add(split,'E','complex',{schema:obj({grants:{type:'object',additionalProperties:{type:'array',items:{enum:['read','write']}}},credentials:{type:'object',additionalProperties:str}}),expected,negative:JSON.stringify(input),pairId,sourceGroup,
   prompt:`把账户转换为权限对象，恰含 grants 与 credentials。两者以原 id 字符串为键。guest 权限是空数组，member 为 ["read"]，admin 为 ["read","write"]；grants 保留每个账户。credentials 只纳入 token 非 null 的账户，空串必须保留。输入：${JSON.stringify(input)}`});
  continue;
 }
 const items=split==='development'?[{id:'0007',state:'ok',note:''},{id:'0010',state:'error',note:'引号"和\\'},{id:'0011',state:'skip',note:null}]
 :[{id:'02',state:'error',note:'A\r\nB'},{id:'03',state:'ok',note:'~/'},{id:'04',state:'skip',note:null}];
 const simple=items.map(x=>({id:x.id,state:x.state,note:x.note}));
 const complex=items.map(x=>({[x.id]:x.state==='skip'?{skipped:true}:x.state==='ok'?{ok:{message:x.note}}:{error:{message:x.note,retryable:false}}}));
 const pairId=`pair:E:${split}`,sourceGroup=`authored:event-${split==='development'?'ci':'delivery'}`;
 add(split,'E','simple',{schema:{type:'array',items:obj({id:str,state:{enum:['ok','error','skip']},note:{type:['string','null']}})},expected:simple,negative:'[]',pairId,sourceGroup,prompt:`按原顺序输出每条记录的 id、state、note，值和类型不变。输入：${JSON.stringify(items)}`});
 const event={oneOf:[obj({skipped:{const:true}}),obj({ok:obj({message:str})}),obj({error:obj({message:str,retryable:{const:false}})})]};
 add(split,'E','complex',{schema:{type:'array',items:{type:'object',minProperties:1,maxProperties:1,additionalProperties:event}},expected:complex,negative:JSON.stringify(simple),pairId,sourceGroup,prompt:`按输入顺序输出数组，每项是仅含一个动态键的对象，键为原 id 字符串。state=skip 时值只能是 {"skipped":true}；ok 时值为 {"ok":{"message":原note}}；error 时值为 {"error":{"message":原note,"retryable":false}}。保留空串、反斜杠与换行，不额外输出 state/note。输入：${JSON.stringify(items)}`});
}

// F: four real parser paths. All edge data and null mappings are public.
const csvCell=x=>'"'+x.replaceAll('"','""')+'"';
const xmlEsc=x=>x.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
for(const split of ['development','holdout']){
 const data=split==='development'?[{code:'001',name:'甲,"乙"',note:'line1\nline2'},{code:'010',name:'ON',note:''}]
 :[{code:'000',name:'x<y & z',note:'C:\\tmp\\a'},{code:'002',name:'false',note:''}];
 for(const format of ['csv','xml','yaml','toml']){
  const rows=clone(data);if(format==='xml')rows[1].note=null;
  const expected=format==='toml'?{records:rows}:rows;
  let raw='';
  if(format==='csv')raw='code,name,note\r\n'+rows.map(r=>Object.values(r).map(csvCell).join(',')).join('\r\n')+'\r\n';
  if(format==='xml')raw='<records>'+rows.map(r=>'<record>'+Object.entries(r).map(([k,v])=>v===null?`<${k} null="true"/>`:`<${k}>${xmlEsc(v)}</${k}>`).join('')+'</record>').join('')+'</records>';
  if(format==='yaml')raw=JSON.stringify(rows); // JSON is a legal YAML 1.2 representation, intentionally accepted.
  if(format==='toml')raw=rows.map(r=>'[[records]]\n'+Object.entries(r).map(([k,v])=>`${k} = ${JSON.stringify(v)}`).join('\n')).join('\n');
  const instructions={csv:'首行表头恰为 code,name,note。RFC 4180 引号规则；字段内换行保留为实际换行；不要用字面量 \\n 替换。所有字段按字符串处理。',xml:'根 records，每行 record，字段顺序 code/name/note。每个字段是一个简单子元素；null 用空元素 <note null="true"/>，空串用空文本元素；其他元素无属性。不能使用 DTD、实体声明或嵌套字段。',yaml:'使用 YAML 1.2 的 JSON 兼容数据类型，不使用锚点、别名、自定义标签；字符串保留原类型。也允许 JSON 语法，因为它是合法 YAML。',toml:'TOML 1.0：顶层只有 records 数组，使用 [[records]]。所有 code/name/note 均为字符串；勿自动转日期、布尔或数字。'}[format];
  const input=split==='holdout'?{byActor:Object.fromEntries(rows.map(r=>[r.name,[{id:r.code,text:r.note}]])),actorOrder:rows.map(r=>r.name)}:rows;
  const mapping=split==='holdout'?'先把输入分组展平：按 actorOrder 遍历 byActor 的键，各组数组保持顺序。每条事件输出 code=事件.id、name=所属键、note=事件.text；只输出这三字段。再执行目标格式转换。':'';
  add(split,'F',format,{format,schema:true,expected,raw,negative:format==='xml'?raw.replace('001','1').replace('000','0'):format==='yaml'?'[]':format==='toml'?'records = []':'code,name,note\r\n',
   sourceGroup:`authored:conversion-${split==='development'?'catalog':'grouped-audit'}`,prompt:`把 JSON 输入无损转换为 ${format.toUpperCase()}。${mapping}${instructions} 输入：${JSON.stringify(input)}`});
 }
}

// G: generate a schema, checked behaviorally rather than by matching one schema text.
for(const split of ['development','holdout'])for(let v=0;v<2;v++){
 let reference,valid,invalid,prompt;
 if(split==='development'){
  reference={type:'object',properties:{mode:{enum:['local','remote']},enabled:bool,path:str,credentials:{oneOf:[obj({token:{type:'string',minLength:1}}),obj({user:str,password:str})]}},required:['mode','enabled'],
   allOf:[{if:{properties:{mode:{const:'local'}},required:['mode']},then:{required:['path'],not:{required:['credentials']}},else:{required:['credentials'],not:{required:['path']}}}],additionalProperties:false};
  valid=[{mode:'local',enabled:false,path:''},{mode:'remote',enabled:true,credentials:{token:'x'}},{mode:'remote',enabled:false,credentials:{user:'',password:''}}];
  invalid=[{},null,[],{mode:'local',enabled:false},{mode:'local',enabled:0,path:'x'},{mode:'remote',enabled:true,path:'x'},
   {mode:'local',enabled:true,path:'x',credentials:{token:'x'}},{mode:'remote',enabled:true,credentials:{token:''}},
   {mode:'remote',enabled:true,credentials:{token:'x',user:'u',password:'p'}},{mode:'remote',enabled:true,credentials:{user:'u'}},
   {mode:'remote',enabled:true,credentials:{user:'u',password:'p',extra:0}},{mode:'local',enabled:true,path:'x',extra:0}];
  prompt='生成 JSON Schema 2020-12，描述如下全部规则：顶层必须为对象，mode 和 enabled 必需；mode 只能 local/remote，enabled 必须布尔。local 必须有字符串 path（可空），且绝不能有 credentials；remote 必须有 credentials，绝不能有 path。credentials 恰为两种形状之一：仅有非空字符串 token；或恰有字符串 user/password（均可空）。顶层和 credentials 禁止其他键。';
  if(v){reference.properties.version={type:'integer',minimum:1,maximum:3};reference.required.push('version');valid=valid.map(x=>({...x,version:2}));invalid=invalid.map(x=>x&&typeof x==='object'&&!Array.isArray(x)?{...x,version:2}:x);invalid.push({...valid[0],version:0},{...valid[1],version:1.5},{...valid[2],version:4},...valid.map(({version,...rest})=>rest));prompt+='另有必需 version，必须为 1 到 3 的整数（含边界）。';}
 }else{
  reference={type:'array',minItems:2,maxItems:4,uniqueItems:true,items:obj({kind:{enum:['start','stop']},name:{type:'string',minLength:1}}),contains:{type:'object',properties:{kind:{const:'start'}},required:['kind']},minContains:1,maxContains:1};
  valid=[[{kind:'start',name:'A'},{kind:'stop',name:'B'}],[{kind:'stop',name:'A'},{kind:'start',name:'B'},{kind:'stop',name:'C'}]];
  invalid=[null,{},[],[valid[0][0]],[valid[0][0],valid[0][0]],[{kind:'start',name:'A'},{kind:'start',name:'B'}],[{kind:'stop',name:'A'},{kind:'stop',name:'B'}],
   [{kind:'start',name:''},valid[0][1]],[{kind:'start',name:'A',extra:1},valid[0][1]],[{kind:'start',name:1},valid[0][1]],...Array.from({length:1},()=>[valid[0][0],...['B','C','D','E'].map(name=>({kind:'stop',name}))])];
  prompt='生成 JSON Schema 2020-12：顶层数组，长度 2 至 4，所有数组元素按完整 JSON 值去重。每个元素只能有必需的 kind、name；kind 是 start/stop，name 是非空字符串。整个数组恰有一个 kind=start 的元素。name 不要求在不同元素间唯一，不能额外限制。';
  if(v){reference.items.properties.name.pattern='^[A-Z][A-Z0-9]*$';invalid.push([{kind:'start',name:'a'},valid[0][1]],[{kind:'start',name:'A-'},valid[0][1]]);prompt+='name 另外必须以一个大写 ASCII 字母开头，之后只有大写 ASCII 字母或数字；不限制长度上界。';}
 }
 const cases=[...valid.map(data=>({data,valid:true})),...invalid.map(data=>({data,valid:false}))];
 add(split,'G',String(v+1),{schema:{type:['object','boolean']},raw:JSON.stringify({$schema:d20,...reference}),negative:'true',requirements:{generatedSchema:{cases}},
 prompt:prompt+' 可以自由选择等价的标准 Schema 写法；只允许本地引用，不允许外部引用；Schema 嵌套深度不超过 64。使用这些有界题目时验证器会限制编译/验证资源。'});
}

// H: inspect semantic IDs/geometry and actual pixels in an inert Chromium SVG image.
for(const split of ['development'])for(let v=0;v<2;v++){
 const width=240,height=120,shift=split==='development'?0:20,color=v?[0,128,255,255]:[255,128,0,255];
 const elements=[{id:'node/a~0',tag:'rect',attrs:{x:20+shift,y:20,width:60,height:40}},
   {id:'node-b',tag:'rect',attrs:{x:150,y:20,width:60,height:40}},
   {id:'edge',tag:'line',attrs:{x1:80+shift,y1:40,x2:150,y2:40}},
   {id:'label',tag:'text',attrs:{x:20+shift,y:90},text:split==='development'?'A < B & "C"':'ON / off ~ 甲'}];
 const svg={width,height,elements,samples:[{x:35+shift,y:35,rgba:color},{x:165,y:35,rgba:[0,170,0,255]},{x:125,y:40,rgba:[0,0,0,255]}]};
 const expected={width,height,viewBox:[0,0,width,height],nodes:Object.fromEntries(elements.map(e=>[e.id,{tag:e.tag,attrs:e.attrs,...(e.text!==undefined?{text:e.text}:{})}]))};
 const raw=`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120"><rect id="node/a~0" x="${20+shift}" y="20" width="60" height="40" fill="rgb(${color.slice(0,3)})"/><rect id="node-b" x="150" y="20" width="60" height="40" fill="#00aa00"/><line id="edge" x1="${80+shift}" y1="40" x2="150" y2="40" stroke="black" stroke-width="4"/><text id="label" x="${20+shift}" y="90">${xmlEsc(elements.at(-1).text)}</text></svg>`;
 add(split,'H',String(v+1),{format:'svg',schema:true,expected,raw,negative:raw.replace('fill="#00aa00"','fill="#ffffff"'),requirements:{svg},
  sourceGroup:`authored:${split==='development'?'node-link':'status-panel'}`,prompt:`生成一个 SVG 图，width=240、height=120、viewBox="0 0 240 120"。元素 ID 必须唯一，元素类型及属性如下（数字为 SVG 用户坐标）：${JSON.stringify(elements)}。第一个 rect 填充 rgb(${color.slice(0,3)})，第二个 rect 填充 #00aa00；line 为黑色，stroke-width=4。必须实际可见，不得用透明度、遮盖或变换改变指定位置/颜色；允许等价颜色写法。text 的文字原样显示（正确处理 XML 转义）。禁止脚本、样式表、动画、foreignObject、外部资源、DTD。`});
}
for(let v=0;v<2;v++){
 const bars=[{id:'bar:left',x:20,y:50,width:30,height:50},{id:'bar:right',x:80,y:20,width:30,height:80}];
 const elements=[...bars.map(({id,...attrs})=>({id,tag:'rect',attrs})),{id:'caption',tag:'text',attrs:{x:20,y:115},text:v?'总计 < 预期 & "保留"':'计数 / 001 ~ 甲'}];
 const svg={width:160,height:130,elements,samples:[{x:25,y:60,rgba:[0,0,255,255]},{x:85,y:40,rgba:[255,0,0,255]},{x:25,y:30,rgba:[0,0,0,0]}]};
 const expected={width:160,height:130,viewBox:[0,0,160,130],nodes:Object.fromEntries(elements.map(e=>[e.id,{tag:e.tag,attrs:e.attrs,...(e.text!==undefined?{text:e.text}:{})}]))};
 const raw=`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="130" viewBox="0 0 160 130"><rect id="bar:left" x="20" y="50" width="30" height="50" fill="blue"/><rect id="bar:right" x="80" y="20" width="30" height="80" fill="red"/><text id="caption" x="20" y="115">${xmlEsc(elements.at(-1).text)}</text></svg>`;
 add('holdout','H',String(v+1),{format:'svg',schema:true,expected,raw,negative:raw.replace('fill="red"','fill="blue"'),requirements:{svg},sourceGroup:'authored:bar-chart',
  prompt:`生成透明背景 SVG 柱状图，width=160、height=130、viewBox="0 0 160 130"。只需两个 rect 柱子和一个 text 标题，精确要求：${JSON.stringify(elements)}。bar:left 填充蓝色，bar:right 填充红色；允许等价颜色写法。柱子底部均为 y=100，不能遮盖、透明或变换。文字正确 XML 转义。禁止脚本、样式表、动画、foreignObject、外部资源、DTD。`});
}
const groups=new Set(gold.development.map(x=>x.sourceGroup));if(gold.holdout.some(x=>groups.has(x.sourceGroup)))throw Error('Source-group leak');
if(fs.existsSync(`${root}/calibration-development-05c8edd2-6ca6-4c95-9090-e6431b8ab415.json`)){const started=JSON.parse(fs.readFileSync(`${root}/calibration-development-05c8edd2-6ca6-4c95-9090-e6431b8ab415.json`));if(sha(packs.development)!==started.packHash)throw Error('Cannot edit an already measured development pack');}
for(const s of ['development','holdout']){fs.writeFileSync(`${root}/${s}.json`,JSON.stringify(packs[s],null,2)+'\n');fs.writeFileSync(`${root}/${s}-gold.json`,JSON.stringify(gold[s],null,2)+'\n');}
const manifest={version:'structured-contract-v2',status:'frozen-development',families:['A','B','C','D','E','F','G','H'],
 development:packs.development.length,holdout:packs.holdout.length,hashes:Object.fromEntries(Object.entries(packs).map(([k,v])=>[k,sha(v)])),goldHashes:Object.fromEntries(Object.entries(gold).map(([k,v])=>[k,sha(v)])),
 sourcePolicy:'Source/schema task-group split; some groups share repository and evaluator. Holdout is screening, not strong independence proof.',
 stoppingRule:'No extra sampling to seek a desired ranking. Preserve failures and alternative-answer reviews; heldout items used for repair lose holdout status.',
 promotion:'Keep easy anchors separate; no difficulty claim until independent configuration/holdout screening.'};
fs.writeFileSync(`${root}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
