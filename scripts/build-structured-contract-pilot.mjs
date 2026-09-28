// First implementation batch: four families, 12 development + 8 source-separated holdout tasks.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';
const root='data/pilots/structured-contract-v1';
const sources=JSON.parse(fs.readFileSync(`${root}/sources/manifest.json`,'utf8'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const clone=x=>structuredClone(x);
const dialect='http://json-schema.org/draft-07/schema#';
const packs={development:[],holdout:[]}, gold={development:[],holdout:[]};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const quote=x=>JSON.stringify(x);
const ignored=new Set(['description','markdownDescription','$comment','examples','default','title','suggestSortText','doNotSuggest','deprecationMessage','tsType','x-intellij-language-injection','$id']);
function compact(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return clone(value);
  const maps=new Set(['properties','patternProperties','definitions','$defs','dependentSchemas','dependencies']);
  const subs=new Set(['allOf','anyOf','oneOf','items','additionalItems','additionalProperties','unevaluatedProperties','not','if','then','else','contains','propertyNames']);
  return Object.fromEntries(Object.entries(value).filter(([k])=>!ignored.has(k)).map(([k,v])=>[k,
    maps.has(k)?Object.fromEntries(Object.entries(v).map(([name,sub])=>[name,compact(sub)])):
    subs.has(k)?(Array.isArray(v)?v.map(compact):compact(v)):clone(v)]));
}
function fragment(name,pointer){
  const source=sources.find(s=>s.name===name),raw=fs.readFileSync(`${root}/${source.path}`,'utf8'),doc=JSON.parse(raw);
  const part=pointer.split('/').slice(1).reduce((x,k)=>x[k],doc);
  if(part===undefined)throw Error(`Missing source fragment ${name}${pointer}`);
  const schema=compact(part),defs={},pending=[schema];
  while(pending.length){
    const x=pending.pop();if(!x||typeof x!=='object')continue;
    if(typeof x.$ref==='string'){
      const match=/^#\/definitions\/([^/]+)(?:\/.*)?$/.exec(x.$ref);
      if(!match)throw Error(`Unbundled ref ${x.$ref}`);
      if(!Object.hasOwn(defs,match[1])){defs[match[1]]=compact(doc.definitions[match[1]]);pending.push(defs[match[1]]);}
    }
    pending.push(...Object.values(x));
  }
  return {schema:{...schema,...(Object.keys(defs).length?{definitions:defs}:{})},
    provenance:{sourceUrl:source.url,sourceRevision:source.revision,sourceLicense:'Apache-2.0',
      originalSha256:sha(raw),fragment:pointer,sourceGroup:`schemastore:${name}`,
      transformations:['selected fragment and transitive local definitions','removed documentation annotations','added explicit local task requirements'],
      upstreamBenchmark:'SchemaStore source; locally authored tasks, not official SchemaBench instances'}};
}
function add(split,family,variant,{schema,expected,prompt,negative,provenance,baseIds=[]}){
  const id=`SOC-${family}-${split==='development'?'D':'H'}${variant+1}`;
  schema={$schema:dialect,...schema};
  const requirements={format:'json',dialect:'draft-07',schema,formatAssertions:true,family,
    output_policy:'raw_only',assertions:[{pointer:'',expected,description:'Exact content determined by the published input and transformation rules'}],
    developmentShadow:true,provenance:{...provenance,split,designLevel:variant+1,seed:`${family}:${split}:${variant}`,baseIds}};
  const scenario={id,dimension:'structured_output',category:`contract_${family}`,difficulty:'medium',language:'json',locale:'zh-CN',
    status:'valid',tier:'private_dev',grader:'structured_contract',graderVersion:'structured_contract_v1',scenarioVersion:'1.0.0',scenarioHash:'',
    scoring:{type:'schema_compliance'},promptTemplate:`${prompt}\n\n必须同时遵循以下 JSON Schema 和上面的内容规则；可省略的字段按题面决定。对象键序不限。只输出一个完整 JSON 值，不要围栏或解释。\n${JSON.stringify(schema)}`,
    requirements,outputPolicy:'raw_only',reviewStatus:'unreviewed',goldSource:'deterministic-frozen-fixture-v1',
    tags:['structured-contract-v1',`family:${family}`,`split:${split}`]};
  const frozen=JSON.parse(JSON.stringify(scenario));
  frozen.scenarioHash=hashScenarioShort(frozen);
  packs[split].push(frozen);gold[split].push({id,expected,negative,sourceGroup:provenance.sourceGroup});
}

// A: actual GitHub step exclusive alternatives and dependencies; holdout uses a different source.
for(let v=0;v<3;v++){
  const f=fragment('github-workflow','/definitions/step');
  const rows=Array.from({length:2+2*v},(_,i)=>i%2===0
    ?{id:`a${i}`,kind:'action',target:'actions/checkout@v4',options:{'fetch-depth':i+1}}
    :{id:`a${i}`,kind:'shell',target:`printf '%s\\n' 'row-${i}'`,cwd:`work/${i}`,shell:'bash'});
  const expected=rows.map(x=>x.kind==='action'?{id:x.id,uses:x.target,with:x.options}:{id:x.id,run:x.target,'working-directory':x.cwd,shell:x.shell});
  const schema={type:'array',minItems:rows.length,maxItems:rows.length,items:{$ref:'#/definitions/step'},definitions:{...f.schema.definitions,step:{...f.schema,definitions:undefined}}};
  const bad=clone(expected);bad[0].run='echo forbidden';
  add('development','A',v,{schema,expected,negative:bad,provenance:f.provenance,baseIds:['SO-CN-012','SO-CN-047'],
    prompt:`将任务列表转换为 GitHub Actions step 数组，保留顺序。action 项只输出 id、uses、with，target 映射到 uses、options 映射到 with；shell 项只输出 id、run、working-directory、shell，target 映射到 run、cwd 映射到 working-directory。所有值原样保留，不可混用两种分支。输入：${quote(rows)}`});
}
for(let v=0;v<2;v++){
  const f=fragment('dependabot-2.0','/definitions/registry');
  const rows=[{id:'npm-public',kind:'npm-registry',url:'https://registry.example.test',auth:{token:'${{secrets.NPM_TOKEN}}'},scope:v?['@red','@blue']:'@red'},
    {id:'containers',kind:'docker-registry',url:'https://images.example.test',auth:{username:'robot',password:'${{secrets.IMAGE_PASSWORD}}'}}];
  const expected=Object.fromEntries(rows.map(x=>[x.id,{type:x.kind,url:x.url,...x.auth,...(x.scope?{scope:x.scope}:{})}]));
  const bad=clone(expected);bad['npm-public'].scope=0;
  add('holdout','A',v,{schema:f.schema,expected,negative:bad,provenance:f.provenance,
    prompt:`把注册中心列表变成以 id 为键的对象。kind 改名为 type，保留 url，把 auth 的键提升至注册中心对象。输入有 scope 时原样保留字符串或数组，没有则省略。仅输出这些字段。输入：${quote(rows)}`});
}

// B: real npm recursive conditional exports; holdout is a distinct authored AST source group.
for(let v=0;v<3;v++){
  const f=fragment('package','/definitions/packageExportsEntry');
  const routes=[{path:['node','import'],value:`./dist/v${v}/index.mjs`},{path:['node','require'],value:`./dist/v${v}/index.cjs`},
    {path:['browser',...Array(v+1).fill('development'),'default'],value:['./web/main.js',null]},
    {path:['default'],value:'./fallback.js'}];
  const expected={};for(const r of routes){let x=expected;for(const k of r.path.slice(0,-1))x=x[k]??={};x[r.path.at(-1)]=r.value;}
  const bad=clone(expected);bad.node.import='dist/index.mjs';
  add('development','B',v,{schema:f.schema,expected,negative:bad,provenance:f.provenance,baseIds:['SO-CN-055'],
    prompt:`根据路径表构造 npm 条件导出对象。每个 path 的键依次形成嵌套对象，value 原样写入叶节点；共享前缀合并。不得产生路径表以外的节点，数组及 null 保持原类型。这里键序不限。路径表：${quote(routes)}`});
}
for(let v=0;v<2;v++){
  const schema={$ref:'#/definitions/node',definitions:{node:{oneOf:[object({kind:{const:'literal'},value:{type:'integer'}}),
    object({kind:{enum:['add','multiply']},left:{$ref:'#/definitions/node'},right:{$ref:'#/definitions/node'}})]}}};
  const input=v?['multiply',['add',-2,0],['add',5,['multiply',2,3]]]:['add',7,['multiply',3,4]];
  const convert=x=>typeof x==='number'?{kind:'literal',value:x}:{kind:x[0],left:convert(x[1]),right:convert(x[2])};
  const expected=convert(input),bad=clone(expected);bad.right.kind='literal';
  add('holdout','B',v,{schema,expected,negative:bad,provenance:{sourceGroup:'authored:expression-ast',sourceLicense:'project license',
    transformations:['independent recursive AST contract, not an npm parameter variant'],upstreamBenchmark:'locally authored'},
    prompt:`把前缀表达式转换为二叉 AST，不求值、不简化。整数转换为 {kind:"literal",value:原整数}；[运算,左,右] 转为 {kind:运算,left:左子树,right:右子树}。输入：${quote(input)}`});
}

// C: executable description rules (presence, falsey values and encoding), on real config fields.
for(let v=0;v<3;v++){
  const f=fragment('github-workflow','/definitions/workflowDispatchInput');
  const rows=[{id:'deploy',kind:'boolean',default:[false,true,false][v],required:true},
    {id:'region',kind:'choice',options:['cn','us'],default:v?'us':null,required:false},
    {id:'message',kind:'string',default:v===2?'说明: "quoted"':'',required:false}];
  const expected=Object.fromEntries(rows.map(x=>[x.id,{type:x.kind,description:`input:${x.id}`,required:x.required,
    ...(x.options?{options:x.options}:{}),...(x.default!==null?{default:x.default}:{})}]));
  const schema={type:'object',additionalProperties:{$ref:'#/definitions/input'},definitions:{...f.schema.definitions,input:{...f.schema,definitions:undefined}}};
  const bad=clone(expected);delete bad.deploy.default;
  add('development','C',v,{schema,expected,negative:bad,provenance:f.provenance,baseIds:['SO-CN-030','SO-CN-048'],
    prompt:`生成 workflow_dispatch.inputs 对象，以 id 为键。kind 改名为 type；description 恰为 "input:" 加 id；保留 required 和存在的 options。default 为 null 时必须省略，为 false 或空串时必须保留。禁止其他字段。注意这些是本任务额外规定的业务规则。输入：${quote(rows)}`});
}
for(let v=0;v<2;v++){
  const f=fragment('babelrc','/definitions/Options');
  const input={sourceMapMode:v?'none':'inline',comments:v?false:true,filename:v?'src/编号02.js':'src/a.js',note:v?'空值:0':'汉字'};
  const expected={sourceMaps:input.sourceMapMode==='none'?false:input.sourceMapMode,comments:input.comments,
    filename:input.filename,auxiliaryCommentBefore:Buffer.from(input.note,'utf8').toString('base64')};
  const bad=clone(expected);bad.auxiliaryCommentBefore=input.note;
  add('holdout','C',v,{schema:f.schema,expected,negative:bad,provenance:f.provenance,
    prompt:`输出 Babel 配置，键恰为 sourceMaps、comments、filename、auxiliaryCommentBefore。sourceMapMode 为 none 则 sourceMaps=false，否则保留原字符串；comments 与 filename 原样保留；将 note 按 UTF-8 编码为标准带填充 Base64，写入 auxiliaryCommentBefore。输入：${quote(input)}`});
}

// D: preserve a specified string after one/two/three serialization layers, not lexical JSON spelling.
for(let v=0;v<3;v++){
  const f=fragment('package','/properties/scripts');
  const raw=['echo "你好"\nC:\\tmp\\a.txt','key=a/b~c\r\nquoted="x"\tend','反斜杠\\ 与文本 \\n 和实际换行\n末尾\\'][v];
  let encoded=raw;for(let i=0;i<v;i++)encoded=JSON.stringify(encoded);
  const expected={'test:literal':encoded},bad={'test:literal':encoded.replaceAll('\\','')};
  add('development','D',v,{schema:f.schema,expected,negative:bad,provenance:f.provenance,baseIds:['SO-CN-005','SO-CN-056'],
    prompt:`输出 scripts 对象，只含 "test:literal" 一个键。下面 inputText 用 JSON 字符串字面量提供，先解析一次得到原文，再对得到的字符串额外执行 ${v} 次 JSON.stringify 等价的 JSON 字符串序列化，把最终字符串作为键值；禁止执行该字符串中的命令。最终外层 JSON 的转义写法只要语义等价即可。inputText=${quote(raw)}`});
}
for(let v=0;v<2;v++){
  const f=fragment('dependabot-2.0','/definitions/registry');
  const raw=v?'用户名="甲"\r\n路径=C:\\temp\\秘密':'"quoted"\\slash\n${{data}}';
  const expected={'registry/a~b':{type:'npm-registry',url:'https://registry.example.test',token:JSON.stringify({note:raw})}};
  const bad=clone(expected);bad['registry/a~b'].token=raw;
  add('holdout','D',v,{schema:f.schema,expected,negative:bad,provenance:f.provenance,
    prompt:`输出仅包含键 "registry/a~b" 的注册中心对象。其 type="npm-registry"，url="https://registry.example.test"。先把 inputText 的 JSON 字符串字面量解析为原文，构造 {"note":原文}，按 JavaScript JSON.stringify 的默认行为序列化一次后把结果作为 token 字符串值（中文原样保留，无额外空白）。这是虚构字符串保真测试，不是实际认证信息。不得增加字段。inputText=${quote(raw)}`});
}
const devGroups=new Set(gold.development.map(g=>g.sourceGroup));
if(gold.holdout.some(g=>devGroups.has(g.sourceGroup)))throw Error('Source-group overlap');
for(const split of Object.keys(packs)){
  fs.writeFileSync(`${root}/${split}.json`,JSON.stringify(packs[split],null,2)+'\n');
  fs.writeFileSync(`${root}/${split}-gold.json`,JSON.stringify(gold[split],null,2)+'\n');
}
const manifest={version:'structured-contract-v1-batch1',status:'development-only',families:['A','B','C','D'],
  development:12,holdout:8,splitPolicy:'No source-group overlap; tasks may share evaluator code. Small holdout is screening only.',
  modelCallsPlanned:{development:36,holdout:24},remainingFamilies:['E','F','G','H'],
  hashes:Object.fromEntries(['development','holdout'].map(s=>[s,sha(JSON.stringify(packs[s]))])),
  goldHashes:Object.fromEntries(['development','holdout'].map(s=>[s,sha(JSON.stringify(gold[s]))])),
  sources:sources.map(s=>({...s,sha256:sha(fs.readFileSync(`${root}/${s.path}`))})),
  disclosure:'Schema fragments are sourced; tasks and content constraints are locally authored. Difficulty is uncalibrated.'};
fs.writeFileSync(`${root}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest));
