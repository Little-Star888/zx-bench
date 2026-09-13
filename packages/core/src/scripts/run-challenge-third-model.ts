import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createDecipheriv,createHash,scryptSync} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {snapshotHash} from '../contracts/pack.js';
import {apiControlStream} from '../evaluationLab/apiControlStream.js';
import {buildChallengePack,candidateQuestion,gradeChallenge} from '../evaluationLab/challengePack.js';
import {API_CONTROL_PROVIDERS,allowedReturnedModel} from '../evaluationLab/hardApiControlPlan.js';
import {lightweightDiscriminationGate,type ObservedDimensionModel} from '../evaluationLab/observedDiscrimination.js';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
const [mode,target,execute]=process.argv.slice(2);
if(!target||!['--prepare','--run'].includes(mode)||(mode==='--prepare'?execute!==undefined:execute!=='--execute'))throw new Error('Usage: --prepare NEW_DIR | --run DIR --execute');
const out=resolve(root,target),provider=API_CONTROL_PROVIDERS.find(p=>p.key==='deepseek-v4-flash');
if(!provider)throw new Error('DeepSeek provider not registered');
const pack=buildChallengePack(),questions=pack.cases.map(c=>candidateQuestion(c));
if(questions.length!==20)throw new Error('Expected the frozen 20-question pack');
const read=(path:string)=>JSON.parse(readFileSync(resolve(root,path),'utf8'));
const save=(path:string,data:unknown)=>writeFileSync(join(out,path),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
const status=(data:unknown)=>{writeFileSync(join(out,'status.json.tmp'),JSON.stringify({...data as object,updatedAt:new Date().toISOString()},null,2));renameSync(join(out,'status.json.tmp'),join(out,'status.json'));};
const sourceFiles=['packages/core/src/scripts/run-challenge-third-model.ts','packages/core/src/evaluationLab/challengePack.ts','packages/core/src/evaluationLab/challengeHall.ts','packages/core/src/evaluationLab/challengeMath.ts','packages/core/src/evaluationLab/challengeRebalance.ts','packages/core/src/evaluationLab/apiControlStream.ts','packages/core/src/evaluationLab/observedDiscrimination.ts'];
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(path=>[path,createHash('sha256').update(readFileSync(join(root,path))).digest('hex')]));
const plan={version:'challenge-third-model-2026-09-13-v1',packVersion:pack.version,packHash:pack.hash,provider,maxTokens:90000,hardSeconds:1200,concurrency:1,automaticRetries:0,judgeCalls:0,questions};

function configuration(){
  const database=new DatabaseSync(join(root,'apps/data/zxbench.db'),{readOnly:true});
  let row:{name:string;baseUrl:string;apiKey:string}|undefined;
  try{row=database.prepare('SELECT name,baseUrl,apiKey FROM ModelConfig WHERE id=?').get(provider!.configId) as typeof row;}finally{database.close();}
  if(!row||row.name!==provider!.requestedModel||!row.apiKey)throw new Error('Selected stored configuration missing or changed');
  const endpoint=new URL(row.baseUrl.replace(/\/$/,'')+'/chat/completions');
  if(endpoint.href!==provider!.endpoint||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error('Unexpected stored endpoint');
  return {...row,endpoint:endpoint.href};
}
function decrypt(value:string){
  const [iv,data]=value.split(':');if(!iv||!data)return value;
  const decipher=createDecipheriv('aes-256-cbc',scryptSync(process.env.ZXBENCH_ENCRYPTION_KEY||'zxbench-default-key-change-me!','zxbench-salt',32),Buffer.from(iv,'hex'));
  return decipher.update(data,'hex','utf8')+decipher.final('utf8');
}
function combinedScreen(thirdRows:{id:string;dimension:string;family:string;pass:boolean|null;state:string}[]){
  const previous=read('reports/challenge-citation-regrade-2026-09-10-v1.3.0/regrade.json');
  assert.equal(previous.version,pack.version);assert.equal(previous.newPackHash,pack.hash);
  const families=new Map(pack.cases.map(c=>[c.id,c.family]));
  const models:ObservedDimensionModel[]=previous.models.map((m:any,index:number)=>({modelId:m.model,modelFamily:index===0?'Qwen3.8-GSQ':'Ornith-1.5',executionClass:'local_unsloth',rows:m.rows.map((r:any)=>({id:r.id,family:families.get(r.id),pass:r.strictPass,state:'completed'}))}));
  models.push({modelId:provider!.requestedModel,modelFamily:provider!.family,executionClass:'provider_api',rows:thirdRows});
  return Object.fromEntries(['hallucination_resistance','reasoning_math'].map(dimension=>[dimension,lightweightDiscriminationGate(dimension,models.map(model=>({...model,rows:model.rows.filter(row=>pack.cases.find(c=>c.id===row.id)?.dimension===dimension)})),{minScoreSpread:8,minSeparatingRate:0.25})]));
}

if(mode==='--prepare'){
  if(existsSync(out))throw new Error('Never overwrite an existing trial');configuration();mkdirSync(out,{recursive:true});
  save('plan.json',plan);save('candidate-questions.json',{version:pack.version,hash:pack.hash,questions});
  save('manifest.json',{planHash:snapshotHash(plan),sourceHashes:sourceHashes(),preparedAt:new Date().toISOString(),policy:'same frozen 20 questions; one attempt; deterministic local grading; no Judge; no historical score writes'});
  status({state:'prepared',completed:0,attempted:0,planned:20});
  console.log(JSON.stringify({prepared:target,questions:20,model:provider.requestedModel,judgeCalls:0}));
}else{
  const manifest=read(join(target,'manifest.json'));
  const verify=()=>{assert.equal(snapshotHash(sourceHashes()),snapshotHash(manifest.sourceHashes));assert.equal(snapshotHash(read(join(target,'plan.json'))),snapshotHash(plan));assert.equal(manifest.planHash,snapshotHash(plan));};
  verify();if(existsSync(join(out,'STOP'))||existsSync(join(out,'RUN_STARTED.json')))throw new Error('Already attempted or stopped; no automatic retry');
  const config=configuration(),key=decrypt(config.apiKey);save('RUN_STARTED.json',{pid:process.pid,startedAt:new Date().toISOString(),manifestHash:snapshotHash(manifest)});
  mkdirSync(join(out,provider.key));const rows:ReturnType<typeof gradeChallenge>[]=[];let attempted=0,completed=0;
  try{
    for(const [index,question] of questions.entries()){
      verify();const challenge=pack.cases[index],relative=join(provider.key,question.id);mkdirSync(join(out,relative));
      const body={model:provider.requestedModel,messages:question.messages,...provider.parameters,max_tokens:90000,stream:true};
      save(join(relative,'request.json'),{endpoint:provider.endpoint,body});save(join(relative,'attempt.json'),{startedAt:new Date().toISOString(),ordinal:++attempted,requestHash:snapshotHash(body),attemptsForQuestion:1});
      const active={state:'running',question:question.id,completed,attempted,planned:20};status(active);console.log(JSON.stringify({started:true,question:question.id,attempted,planned:20}));
      let lastProgress=0;const raw=await apiControlStream({endpoint:config.endpoint,key,body,wireFile:join(out,relative,'wire.sse'),stopFile:join(out,'STOP'),timeoutMs:1_200_000,onProgress:progress=>{if(Date.now()-lastProgress>=5000){lastProgress=Date.now();status({...active,progress});}}});
      save(join(relative,'raw.json'),raw);const failure=raw.error??(allowedReturnedModel(provider.key,raw.returnedModels)?null:'unexpected_or_missing_returned_model');
      const grade=gradeChallenge(challenge,raw.content,!failure);rows.push(grade);save(join(relative,'grade.json'),grade);save(join(provider.key,`grades-${String(rows.length).padStart(3,'0')}.json`),rows);
      if(failure)throw new Error(failure);completed++;console.log(JSON.stringify({question:question.id,completed,attempted,strictPass:grade.strictPass,milliseconds:raw.latencyMs,returnedModels:raw.returnedModels}));
    }
    const thirdRows=rows.map((grade,index)=>({id:grade.id,dimension:pack.cases[index].dimension,family:pack.cases[index].family,pass:grade.strictPass,state:'completed'}));
    const screening=combinedScreen(thirdRows);save('screening.json',screening);status({state:'completed',completed,attempted,planned:20,judgeCalls:0,productionWrites:false,screenReady:Object.values(screening).every((x:any)=>x.readyForMaintainerFreeze)});
  }catch(value){
    const message=value instanceof Error?value.message:'';const error=/^(HTTP_\d+|truncated|timeout_or_cancelled|unexpected_or_missing_returned_model|missing_done|non_stop_finish)$/.test(message)?message:'execution_or_integrity_error';
    save('STOP',{error,attempted,completed,automaticRetries:0});status({state:'stopped',error,completed,attempted,planned:20,automaticRetries:0});console.log(JSON.stringify({state:'stopped',error,completed,attempted}));process.exitCode=1;
  }
}
