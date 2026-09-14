/** One explicitly requested 8-call screen. Never reads coordinator answers into prompts. */
import { createHash,createDecipheriv,scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,writeFileSync,mkdirSync,existsSync,renameSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { examStream } from '../evaluationLab/examPaper/stream.js';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const pack=join(root,'reports/ultra-math-20260914-pack-v2');
const dir=resolve(root,process.argv[2]??'reports/ultra-qwen-screen-20260914');
const ledger=join(root,'reports/ultra-v2-qwen-eight-call-budget');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const save=(p:string,v:unknown)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const sha=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const index=read(join(pack,'candidate-questions.json'));
if(index.questions.length!==8||index.policy.version!=='ultra-math-2026-09-14-v2')throw Error('Unexpected frozen selection');
const tracked=[join(pack,'manifest.json'),join(pack,'candidate-questions.json'),...index.questions.map((q:{file:string})=>join(pack,q.file)),
  fileURLToPath(import.meta.url),join(root,'packages/core/src/evaluationLab/examPaper/stream.ts'),join(root,'packages/core/src/evaluationLab/he001JudgeTrial.ts')];
const hashes=Object.fromEntries(tracked.map(p=>[p,sha(p)]));
function frozen(){for(const [p,h] of Object.entries(hashes))if(sha(p)!==h)throw Error('Source or question changed during run');}
const model='qwen3.8-27b-nvfp4',endpoint='http://127.0.0.1:8081/v1/chat/completions';
const db=new DatabaseSync(join(root,'apps/data/zxbench.db'),{readOnly:true});
let config:{name:string;baseUrl:string;apiKey:string}|undefined;
try{config=db.prepare('SELECT name,baseUrl,apiKey FROM ModelConfig WHERE id=?').get('086461bc-49c6-4bd6-b4b8-f8260be0f71f') as typeof config;}finally{db.close();}
if(!config||config.name!==model||config.baseUrl.replace(/\/$/,'')+'/chat/completions'!==endpoint)throw Error('Stored model configuration changed');
let key=config.apiKey??'';
if(/^[a-f0-9]{32}:[a-f0-9]+$/i.test(key)){
  const [iv,data]=key.split(':');const decipher=createDecipheriv('aes-256-cbc',scryptSync(process.env.ZXBENCH_ENCRYPTION_KEY||'zxbench-default-key-change-me!','zxbench-salt',32),Buffer.from(iv,'hex'));
  key=decipher.update(data,'hex','utf8')+decipher.final('utf8');
}
async function check(){
  const db=new DatabaseSync(join(root,'apps/data/zxbench.db'),{readOnly:true});
  try{if(db.prepare("SELECT id FROM EvalRun WHERE status='running' LIMIT 1").get())throw Error('Formal benchmark running');}finally{db.close();}
  const r=await fetch('http://127.0.0.1:8081/v1/models',{signal:AbortSignal.timeout(5000)}),m=await r.json() as {data:{id:string}[]};
  if(!r.ok||m.data.length!==1||m.data[0].id!==model)throw Error('Expected model not loaded');
  const pr=await fetch('http://127.0.0.1:8081/props',{signal:AbortSignal.timeout(5000)}),p=await pr.json() as {default_generation_settings?:{n_ctx?:number}};
  if(!pr.ok||p.default_generation_settings?.n_ctx!==120000)throw Error('Unexpected local context');
}
await check();
if(existsSync(dir)||existsSync(ledger))throw Error('Screen or its 8-call ledger already exists; no automatic restart');
mkdirSync(dir);mkdirSync(ledger);
save(join(dir,'plan.json'),{model,endpoint,contractHash:index.contractHash,hashes,questions:index.questions.map((q:{id:string})=>q.id),
  maxCalls:8,automaticRetries:0,source:'single-question files only',freshContextPerGroup:true,carry:'previous final answer text, no reasoning or scores',
  outputCap:'min(110000,120000-UTF8_bytes(messages)-8192); conservative prompt reserve',proofScoring:'assistant preliminary review; independent human review required for publication',productionWrites:false});
const answers:{id:string;groupId:string;questionHash:string;outcome:string;output:string}[]=[];
const prompts=new Map<string,{role:string;content:string}[]>();
const status=(s:unknown)=>{writeFileSync(join(dir,'status.tmp'),JSON.stringify(s,null,2));renameSync(join(dir,'status.tmp'),join(dir,'status.json'));};
try{
  for(const entry of index.questions){
    frozen();if(existsSync(join(dir,'STOP')))break;await check();
    const question=read(join(pack,entry.file));
    const messages:{role:string;content:string}[]=[];
    for(const a of answers.filter(a=>a.groupId===entry.groupId))messages.push(...prompts.get(a.id)!,{role:'assistant',content:a.output||'本问未提交答案。'});
    messages.push(...question.messages);prompts.set(entry.id,question.messages);
    const promptByteReserve=Buffer.byteLength(JSON.stringify(messages),'utf8')+8192;
    const maxTokens=Math.min(110000,120000-promptByteReserve);
    if(maxTokens<16384)throw Error('Prior submitted answers exceed reserved prompt capacity');
    const item=join(dir,entry.id);mkdirSync(item);
    const body={model,messages,temperature:0.6,top_p:0.95,max_tokens:maxTokens,stream:true};
    save(join(item,'request.json'),{endpoint,body,questionHash:entry.questionHash,promptByteReserve});
    save(join(ledger,`${answers.length+1}.json`),{id:entry.id,startedAt:new Date().toISOString()});
    const active={state:'running',completed:answers.length,planned:8,id:entry.id,hardSeconds:entry.hardSeconds,maxTokens};
    status(active);console.log(JSON.stringify(active));let last=0;
    const raw=await examStream({endpoint,key,body,wireFile:join(item,'wire.sse'),stopFile:join(dir,'STOP'),timeoutMs:entry.hardSeconds*1000,
      onProgress:p=>{if(Date.now()-last>5000){last=Date.now();status({...active,progress:p});}}});
    save(join(item,'raw.json'),raw);writeFileSync(join(item,'answer.md'),raw.content,{flag:'wx'});
    const correctModel=raw.returnedModels.length>0&&raw.returnedModels.every(m=>m===model);
    const outcome=!correctModel||existsSync(join(dir,'STOP'))?'environment_error':raw.error==='truncated'?'truncated':raw.error==='timeout_or_cancelled'?'timeout':raw.error?'environment_error':'completed';
    answers.push({id:entry.id,groupId:entry.groupId,questionHash:entry.questionHash,outcome,output:raw.content});
    save(join(item,'outcome.json'),{outcome,error:raw.error,correctModel});save(join(dir,`submission-${answers.length}.json`),answers);
    console.log(JSON.stringify({id:entry.id,outcome,characters:raw.content.length,milliseconds:raw.latencyMs}));
    if(outcome==='environment_error')break;
  }
}finally{
  save(join(dir,'submission.json'),{model,contractHash:index.contractHash,answers});
  const completed=answers.length===8&&answers.every(a=>a.outcome!=='environment_error');
  status({state:completed?'completed':'incomplete',recorded:answers.length,planned:8,proofReview:'pending'});
}
