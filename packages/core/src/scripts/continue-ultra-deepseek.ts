/** Resume the interrupted DeepSeek screen from its preserved three answers; never retries them. */
import {createHash,createDecipheriv,scryptSync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {examStream} from '../evaluationLab/examPaper/stream.js';
import {API_CONTROL_PROVIDERS,allowedReturnedModel} from '../evaluationLab/apiControlPlan.js';

const root=fileURLToPath(new URL('../../../../',import.meta.url)),pack=join(root,'reports/ultra-math-20260914-pack-v2');
const dir=join(root,'reports/ultra-deepseek-screen-20260914'),ledger=join(root,'reports/ultra-v2-deepseek-eight-call-budget');
const original=join(root,'packages/core/src/scripts/run-ultra-deepseek.ts');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8')),save=(p:string,v:unknown)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex'),index=read(join(pack,'candidate-questions.json')),plan=read(join(dir,'plan.json'));
const provider=API_CONTROL_PROVIDERS.find(p=>p.key==='deepseek-v4-flash');if(!provider)throw Error('Provider missing');
if(index.contractHash!==plan.contractHash||index.questions.length!==8||read(join(dir,'status.json')).recorded!==3)throw Error('Unexpected interrupted state');
if(plan.hashes[original]!==sha(original)||readdirSync(ledger).filter(n=>n.endsWith('.json')).length!==3)throw Error('Original runner or ledger changed');
for(const [p,h] of Object.entries(plan.hashes) as [string,string][])if(sha(p)!==h)throw Error('Frozen source changed');
const saved=read(join(dir,'submission.json')).answers as {id:string;groupId:string;questionHash:string;outcome:string;output:string}[];
if(saved.length!==3||saved.map(a=>a.id).join(',')!==index.questions.slice(0,3).map((q:{id:string})=>q.id).join(','))throw Error('Unexpected saved answers');

const db=new DatabaseSync(join(root,'apps/data/zxbench.db'),{readOnly:true});let config:{name:string;baseUrl:string;apiKey:string}|undefined;
try{config=db.prepare('SELECT name,baseUrl,apiKey FROM ModelConfig WHERE id=?').get(provider.configId) as typeof config;
  const conflict=db.prepare("SELECT id FROM EvalRun WHERE status='running' AND modelConfigId=? LIMIT 1").get(provider.configId);if(conflict)throw Error('DeepSeek formal benchmark running');
}finally{db.close();}
if(!config||config.name!==provider.requestedModel||config.baseUrl.replace(/\/$/,'')+'/chat/completions'!==provider.endpoint||!config.apiKey)throw Error('Configuration changed');
let key=config.apiKey;if(/^[a-f0-9]{32}:[a-f0-9]+$/i.test(key)){const [iv,data]=key.split(':');const d=createDecipheriv('aes-256-cbc',scryptSync(process.env.ZXBENCH_ENCRYPTION_KEY||'zxbench-default-key-change-me!','zxbench-salt',32),Buffer.from(iv,'hex'));key=d.update(data,'hex','utf8')+d.final('utf8');}
const prompts=new Map<string,{role:string;content:string}[]>();for(const e of index.questions.slice(0,3)){prompts.set(e.id,read(join(pack,e.file)).messages);}
const answers=[...saved],status=(s:unknown)=>{writeFileSync(join(dir,'status.tmp'),JSON.stringify(s,null,2));renameSync(join(dir,'status.tmp'),join(dir,'status.json'));};
save(join(dir,'RESUME.json'),{reason:'unrelated local Qwen formal run triggered overly broad guard',preserved:3,remaining:5,automaticRetries:0,continuationRunnerSha256:sha(fileURLToPath(import.meta.url))});
try{for(const entry of index.questions.slice(3)){
  for(const [p,h] of Object.entries(plan.hashes) as [string,string][])if(sha(p)!==h)throw Error('Frozen source changed');
  if(existsSync(join(dir,'STOP')))break;
  const question=read(join(pack,entry.file)),messages:{role:string;content:string}[]=[];
  for(const a of answers.filter(a=>a.groupId===entry.groupId))messages.push(...prompts.get(a.id)!,{role:'assistant',content:a.output||'本问未提交答案。'});
  messages.push(...question.messages);prompts.set(entry.id,question.messages);
  const item=join(dir,entry.id);if(existsSync(item))throw Error('Would overwrite prior request');mkdirSync(item);
  const body={model:provider.requestedModel,messages,...provider.parameters,max_tokens:393216,stream:true};save(join(item,'request.json'),{endpoint:provider.endpoint,body,questionHash:entry.questionHash});
  save(join(ledger,`${answers.length+1}.json`),{id:entry.id,startedAt:new Date().toISOString()});
  const active={state:'running',completed:answers.length,planned:8,id:entry.id,hardSeconds:entry.hardSeconds,maxTokens:393216};status(active);console.log(JSON.stringify(active));let last=0;
  const raw=await examStream({endpoint:provider.endpoint,key,body,wireFile:join(item,'wire.sse'),stopFile:join(dir,'STOP'),timeoutMs:entry.hardSeconds*1000,onProgress:p=>{if(Date.now()-last>5000){last=Date.now();status({...active,progress:p});}}});
  save(join(item,'raw.json'),raw);writeFileSync(join(item,'answer.md'),raw.content,{flag:'wx'});const correctModel=allowedReturnedModel(provider.key,raw.returnedModels);
  const outcome=!correctModel||existsSync(join(dir,'STOP'))?'environment_error':raw.error==='truncated'?'truncated':raw.error==='timeout_or_cancelled'?'timeout':raw.error?'environment_error':'completed';
  answers.push({id:entry.id,groupId:entry.groupId,questionHash:entry.questionHash,outcome,output:raw.content});save(join(item,'outcome.json'),{outcome,error:raw.error,correctModel,returnedModels:raw.returnedModels});save(join(dir,`submission-${answers.length}.json`),answers);
  console.log(JSON.stringify({id:entry.id,outcome,characters:raw.content.length,milliseconds:raw.latencyMs,returnedModels:raw.returnedModels}));if(outcome==='environment_error')break;
}}finally{save(join(dir,'submission-final.json'),{model:provider.requestedModel,contractHash:index.contractHash,answers});const completed=answers.length===8&&answers.every(a=>a.outcome!=='environment_error');status({state:completed?'completed':'incomplete',recorded:answers.length,planned:8,proofReview:'pending'});}
