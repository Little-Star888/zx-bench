import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createDecipheriv,createHash,scryptSync} from 'node:crypto';
import {existsSync,readdirSync,readFileSync,renameSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {snapshotHash} from '../contracts/pack.js';
import {apiControlStream} from '../evaluationLab/apiControlStream.js';
import {buildChallengePack,candidateQuestion,gradeChallenge} from '../evaluationLab/challengePack.js';
import {API_CONTROL_PROVIDERS,allowedReturnedModel} from '../evaluationLab/hardApiControlPlan.js';
import {lightweightDiscriminationGate,type ObservedDimensionModel} from '../evaluationLab/observedDiscrimination.js';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
const [target,execute]=process.argv.slice(2);if(!target||execute!=='--execute')throw new Error('Usage: DIR --execute');
const out=resolve(root,target),provider=API_CONTROL_PROVIDERS.find(p=>p.key==='deepseek-v4-flash');if(!provider)throw new Error('Provider missing');
const read=(path:string)=>JSON.parse(readFileSync(resolve(root,path),'utf8'));
const save=(path:string,data:unknown)=>writeFileSync(join(out,path),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
const status=(data:unknown)=>{writeFileSync(join(out,'status.json.tmp'),JSON.stringify({...data as object,updatedAt:new Date().toISOString()},null,2));renameSync(join(out,'status.json.tmp'),join(out,'status.json'));};
const pack=buildChallengePack(),questions=pack.cases.map(c=>candidateQuestion(c)),manifest=read(join(target,'manifest.json')),plan=read(join(target,'plan.json'));
assert.equal(plan.packHash,pack.hash);assert.equal(plan.provider.key,provider.key);assert.equal(manifest.planHash,snapshotHash(plan));
for(const [path,hash] of Object.entries(manifest.sourceHashes as Record<string,string>))assert.equal(createHash('sha256').update(readFileSync(join(root,path))).digest('hex'),hash);
const stopped=read(join(target,'status.json'));assert.equal(stopped.state,'stopped');assert.equal(stopped.error,'truncated');
if(existsSync(join(out,'CONTINUATION_STARTED.json')))throw new Error('Continuation already attempted');
const gradeFiles=readdirSync(join(out,provider.key)).filter(name=>/^grades-\d{3}\.json$/.test(name)).sort();
if(!gradeFiles.length)throw new Error('No saved grades');const rows=read(join(target,provider.key,gradeFiles.at(-1)!));
assert.equal(rows.length,stopped.attempted);for(let i=0;i<rows.length;i++)assert.equal(rows[i].id,pack.cases[i].id);

function configuration(){
 const db=new DatabaseSync(join(root,'apps/data/zxbench.db'),{readOnly:true});let row:{name:string;baseUrl:string;apiKey:string}|undefined;
 try{row=db.prepare('SELECT name,baseUrl,apiKey FROM ModelConfig WHERE id=?').get(provider!.configId) as typeof row;}finally{db.close();}
 if(!row||row.name!==provider!.requestedModel||!row.apiKey)throw new Error('Selected stored configuration missing or changed');const endpoint=new URL(row.baseUrl.replace(/\/$/,'')+'/chat/completions');
 if(endpoint.href!==provider!.endpoint||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error('Unexpected stored endpoint');return {...row,endpoint:endpoint.href};
}
function decrypt(value:string){const [iv,data]=value.split(':');if(!iv||!data)return value;const d=createDecipheriv('aes-256-cbc',scryptSync(process.env.ZXBENCH_ENCRYPTION_KEY||'zxbench-default-key-change-me!','zxbench-salt',32),Buffer.from(iv,'hex'));return d.update(data,'hex','utf8')+d.final('utf8');}
function screen(){
 const previous=read('reports/challenge-citation-regrade-2026-09-10-v1.3.0/regrade.json');
 assert.equal(previous.version,pack.version);assert.equal(previous.newPackHash,pack.hash);const families=new Map(pack.cases.map(c=>[c.id,c.family]));
 const models:ObservedDimensionModel[]=previous.models.map((m:any,index:number)=>({modelId:m.model,modelFamily:index===0?'Qwen3.8-GSQ':'Ornith-1.5',executionClass:'local_unsloth',rows:m.rows.map((r:any)=>({id:r.id,family:families.get(r.id),pass:r.strictPass,state:'completed'}))}));
 models.push({modelId:provider!.requestedModel,modelFamily:provider!.family,executionClass:'provider_api',rows:rows.map((r:any)=>({id:r.id,family:families.get(r.id)!,pass:r.strictPass,state:'completed'}))});
 return Object.fromEntries(['hallucination_resistance','reasoning_math'].map(dimension=>{
  const selected=models.map(model=>({...model,rows:model.rows.filter(row=>pack.cases.find(c=>c.id===row.id)?.dimension===dimension)}));
  return [dimension,lightweightDiscriminationGate(dimension,selected)];
 }));
}

const config=configuration(),key=decrypt(config.apiKey),continuationSourceHash=createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
save('CONTINUATION_STARTED.json',{startedAt:new Date().toISOString(),fromOrdinal:rows.length+1,reason:'prior single attempt reached token limit; preserve failure and continue without retry',continuationSourceHash});
let attempted=rows.length,normalCompleted=rows.filter((r:any)=>r.error===null||r.error===undefined).length,budgetFailures=rows.length-normalCompleted;
try{
 for(let index=rows.length;index<questions.length;index++){
  const question=questions[index],challenge=pack.cases[index],relative=join(provider.key,question.id);mkdirSync(join(out,relative));
  const body={model:provider.requestedModel,messages:question.messages,...provider.parameters,max_tokens:90000,stream:true};save(join(relative,'request.json'),{endpoint:provider.endpoint,body});save(join(relative,'attempt.json'),{startedAt:new Date().toISOString(),ordinal:++attempted,requestHash:snapshotHash(body),attemptsForQuestion:1});
  const active={state:'running_continuation',question:question.id,recorded:rows.length,attempted,planned:20};status(active);console.log(JSON.stringify({started:true,question:question.id,attempted,planned:20}));
  let lastProgress=0;const raw=await apiControlStream({endpoint:config.endpoint,key,body,wireFile:join(out,relative,'wire.sse'),stopFile:join(out,'CONTINUATION_STOP'),timeoutMs:1_200_000,onProgress:progress=>{if(Date.now()-lastProgress>=5000){lastProgress=Date.now();status({...active,progress});}}});
  save(join(relative,'raw.json'),raw);const failure=raw.error??(allowedReturnedModel(provider.key,raw.returnedModels)?null:'unexpected_or_missing_returned_model');const grade=gradeChallenge(challenge,raw.content,!failure);rows.push(grade);save(join(relative,'grade.json'),grade);save(join(provider.key,`grades-${String(rows.length).padStart(3,'0')}.json`),rows);
  if(!failure)normalCompleted++;else if(['truncated','timeout_or_cancelled','non_stop_finish'].includes(failure))budgetFailures++;else throw new Error(failure);
  console.log(JSON.stringify({question:question.id,recorded:rows.length,strictPass:grade.strictPass,outcome:failure??'completed',milliseconds:raw.latencyMs,returnedModels:raw.returnedModels}));
 }
 const screening=screen();save('screening.json',screening);status({state:'completed',recorded:rows.length,normalCompleted,budgetFailures,attempted,planned:20,judgeCalls:0,productionWrites:false,screenReady:Object.values(screening).every((x:any)=>x.readyForMaintainerFreeze)});
}catch(value){const message=value instanceof Error?value.message:'';const error=/^(HTTP_\d+|unexpected_or_missing_returned_model|missing_done)$/.test(message)?message:'execution_or_integrity_error';save('CONTINUATION_STOP',{error,attempted,recorded:rows.length,automaticRetries:0});status({state:'stopped',error,recorded:rows.length,attempted,planned:20,automaticRetries:0});console.log(JSON.stringify({state:'stopped',error,recorded:rows.length,attempted}));process.exitCode=1;}
