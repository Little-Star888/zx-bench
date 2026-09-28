import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import type {Evaluator} from './index.js';
import type {CriterionResult,ScenarioResult} from '@zxbench/types';
import {structuredContractV2Evaluator,type ExtendedContract} from './structuredContractV2.js';

export interface GroundedContract extends ExtendedContract {
  oracleSet?:'frontier-v1'|'frontier-v2'|'frontier-v3'|'frontier-v4'|'frontier-v5';
  oracleRef:string;
  oracleHash:string;
  sourceGroup:string;
  challengeFamily:string;
}
export interface GroundedOracle {
  expected:unknown;
  sources:Record<string,string>;
  /** JSON pointers to the source IDs that establish each derived value. */
  provenance:Record<string,string[]>;
  /** Only explicitly listed semantic alternatives are accepted. */
  allowed?:Record<string,unknown[]>;
}
const sha=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const oracleFile=(set:GroundedContract['oracleSet'])=>process.env.ZXBENCH_STRUCTURED_ORACLE_PATH
  ??fileURLToPath(new URL(`../../../../data/pilots/structured-contract-${['frontier-v2','frontier-v3','frontier-v4','frontier-v5'].includes(set??'')?set:'frontier-v1'}/oracle.private.json`,import.meta.url));
const unavailable=(error:unknown):Partial<ScenarioResult>=>({totalScore:0,environmentError:true,humanReviewRequired:true,axisScores:{},
  criterionResults:[{id:'structured_v4_oracle_available',description:'Frozen private oracle available',status:'unmeasured',critical:true,
    source:'unmeasured',evidence:String(error)}],evidence:[`STRUCTURED_V4_UNAVAILABLE: ${String(error)}`]});
function loadOracle(req:GroundedContract,scenarioId:string):GroundedOracle {
  if(req.oracleRef!==scenarioId||!/^SOC4-[A-Z0-9]+-[A-Z0-9-]+$/.test(req.oracleRef)
    ||!/^[a-f0-9]{64}$/.test(req.oracleHash)||req.assertions?.length||req.contentSchema!==undefined)
    throw Error('Invalid or public v4 oracle reference');
  if(req.oracleSet!==undefined&&!['frontier-v1','frontier-v2','frontier-v3','frontier-v4','frontier-v5'].includes(req.oracleSet))throw Error('Unknown oracle set');
  const bank=JSON.parse(readFileSync(oracleFile(req.oracleSet),'utf8')) as Record<string,GroundedOracle>;
  const entry=bank[req.oracleRef];
  if(!entry||sha(entry)!==req.oracleHash||!entry.sources||!entry.provenance||!Object.hasOwn(entry,'expected'))
    throw Error('Frozen v4 oracle missing or hash mismatch');
  for(const ids of Object.values(entry.provenance))
    if(!Array.isArray(ids)||ids.some(id=>!Object.hasOwn(entry.sources,id)))throw Error('Oracle provenance references an unknown source');
  return entry;
}
const pointerKey=(s:string)=>s.replaceAll('~','~0').replaceAll('/','~1');
function leaves(value:unknown,path='',out=new Map<string,unknown>()):Map<string,unknown> {
  if(Array.isArray(value)){
    if(!value.length)out.set(path,value);
    else value.forEach((item,i)=>leaves(item,`${path}/${i}`,out));
  }else if(value!==null&&typeof value==='object'){
    const rows=Object.entries(value as Record<string,unknown>);
    if(!rows.length)out.set(path,value);
    else rows.forEach(([key,item])=>leaves(item,`${path}/${pointerKey(key)}`,out));
  }else out.set(path,value);
  return out;
}
function parseValue(req:GroundedContract,raw:string):unknown {
  if(req.format==='json')return JSON.parse(raw);
  if(!['csv','xml','toml','yaml'].includes(req.format))throw Error('v4 source grounding supports JSON/CSV/XML/TOML/YAML');
  const run=spawnSync(process.env.ZXBENCH_PYTHON??'python',[fileURLToPath(new URL('./structuredFormats.py',import.meta.url))],
    {input:JSON.stringify({format:req.format,text:raw}),encoding:'utf8',timeout:3000,maxBuffer:1024*1024,windowsHide:true});
  if(run.error||run.status!==0)throw Error(String(run.error??run.stderr));
  const result=JSON.parse(run.stdout);
  if(!result.ok)throw Error(result.error);
  return result.value;
}
export const structuredContractV4Evaluator:Evaluator={name:'structured_contract',version:'structured_contract_v4',
  async evaluate(scenario,output,metadata,response){
    const req=scenario.requirements as unknown as GroundedContract;
    let oracle:GroundedOracle;
    try{oracle=loadOracle(req,scenario.id);}catch(error){return unavailable(error);}
    const base=await structuredContractV2Evaluator.evaluate(scenario,output,metadata,response);
    if(base.environmentError)return base;
    const metrics=base.structuredContractMetrics!;
    let data:unknown;
    if(metrics.syntaxValid){
      try{data=parseValue(req,output);}catch(error){return unavailable(error);}
    }
    const expected=leaves(oracle.expected),actual=metrics.syntaxValid?leaves(data):new Map<string,unknown>();
    let found=0,typeCorrect=0,valueCorrect=0,evidenceCorrect=0;
    const evidencePath=(path:string)=>path.endsWith('/sourceIds')||/\/sourceIds\/\d+$/.test(path);
    const evidenceCount=[...expected.keys()].filter(evidencePath).length;
    const mismatches:string[]=[];
    for(const [path,wanted] of expected){
      if(!actual.has(path)){mismatches.push(`${path||'/'}: missing`);continue;}
      found++;
      const got=actual.get(path);
      if((wanted===null?null:Array.isArray(wanted)?'array':typeof wanted)===(got===null?null:Array.isArray(got)?'array':typeof got))typeCorrect++;
      const accepted=isDeepStrictEqual(got,wanted)||(oracle.allowed?.[path]??[]).some(v=>isDeepStrictEqual(got,v));
      if(evidencePath(path)){
        if(accepted)evidenceCorrect++;
      }else if(accepted)valueCorrect++;
      if(!accepted)mismatches.push(`${path||'/'}: value/type mismatch`);
    }
    const extra=[...actual.keys()].filter(path=>!expected.has(path));
    const contentValid=metrics.syntaxValid&&mismatches.length===0&&extra.length===0;
    const valueDenominator=expected.size-evidenceCount;
    const criterion:CriterionResult={id:'structured_grounded_content',description:'Every required value and source reference is correct; no extra values',
      status:contentValid?'pass':'fail',critical:true,source:'verified',evidence:contentValid?'Frozen source-grounded oracle matched':
        `${mismatches.slice(0,8).join('; ')}${extra.length?`; ${extra.length} extra paths`:''}`};
    const criteria=[...(base.criterionResults??[]),criterion];
    metrics.version=4;metrics.contentValid=contentValid;metrics.complete=criteria.every(c=>c.status==='pass');
    metrics.partialScore=100*criteria.filter(c=>c.status==='pass').length/criteria.length;
    metrics.grounded={targetLeaves:expected.size,foundLeaves:found,typeCorrect,valueCorrect,valueTargetLeaves:valueDenominator,
      extraLeaves:extra.length,evidenceCorrect,evidenceTargetLeaves:evidenceCount,
      pathRecall:expected.size?found/expected.size:1,valueAccuracy:valueDenominator?valueCorrect/valueDenominator:1};
    return {...base,criterionResults:criteria,structuredContractMetrics:metrics,
      totalScore:metrics.complete?100:0,deterministicScore:metrics.complete?100:0,
      axisScores:{...base.axisScores,source_value_accuracy:100*metrics.grounded.valueAccuracy,
        path_recall:100*metrics.grounded.pathRecall,content_fidelity:contentValid?100:0},
      evidence:[`STRUCTURED_CONTRACT_RESULT: ${metrics.complete?'pass':'fail'}`,...(!output.trim()?['STRUCTURED_EMPTY_ANSWER: successful request returned no answer']:[])]};
  }};
