import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {Evaluator} from './index.js';
import type {ScenarioResult,CriterionResult} from '@zxbench/types';
import {prepareStructuredContract,structuredContractEvaluator,type StructuredContractRequirements} from './structuredContract.js';
// @ts-ignore Local runtime asset copied with the build; never contains model code.
import {renderStructuredSvg} from './structuredSvg.mjs';

export interface ExtendedContract extends Omit<StructuredContractRequirements,'format'> {
  format:'json'|'csv'|'xml'|'toml'|'yaml'|'svg';
  generatedSchema?: {cases:Array<{data:unknown;valid:boolean}>};
  svg?:{width:number;height:number;elements:Array<{id:string;tag:string;attrs:Record<string,unknown>;text?:string}>;
    samples:Array<{x:number;y:number;rgba:number[]}>};
}
const chrome=process.env.ZXBENCH_CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe';
export function prepareExtendedContract(req:ExtendedContract){
  if(!['json','csv','xml','toml','yaml','svg'].includes(req.format))throw Error('Unsupported extended format');
  prepareStructuredContract({...req,format:'json'});
  // AJV 8.20 fails official annotation/dynamic-reference vectors for these shapes.
  // Frozen task contracts with them are unavailable, never silently scored.
  const check=(x:unknown):void=>{
    if(!x||typeof x!=='object')return;
    const s=x as Record<string,unknown>;
    if(Object.hasOwn(s,'$dynamicRef')||(Object.hasOwn(s,'if')&&Object.hasOwn(s,'else')&&!Object.hasOwn(s,'then')))
      throw Error('AJV profile does not admit dynamicRef or if/else without then; see pinned standard-suite audit');
    for(const key of ['properties','patternProperties','$defs','definitions','dependentSchemas','dependencies']){
      const map=s[key];if(map&&typeof map==='object')for(const value of Object.values(map))if(!Array.isArray(value))check(value);
    }
    for(const key of ['allOf','anyOf','oneOf','items','prefixItems','additionalItems','additionalProperties','unevaluatedProperties','unevaluatedItems','not','if','then','else','contains','propertyNames','contentSchema']){
      const value=s[key];if(Array.isArray(value))value.forEach(check);else check(value);
    }
  };
  check(req.schema);check(req.contentSchema);Object.values(req.references??{}).forEach(check);
  if(req.generatedSchema && (req.format!=='json'||!req.generatedSchema.cases.length||req.generatedSchema.cases.some(c=>typeof c.valid!=='boolean')))throw Error('Invalid generated-schema cases');
  if(req.generatedSchema){
    const r=spawnSync(process.env.ZXBENCH_PYTHON??'python',['-c','import importlib.metadata; assert importlib.metadata.version("jsonschema")=="4.26.0"'],{timeout:5000,windowsHide:true});
    if(r.status!==0)throw Error('Pinned python-jsonschema 4.26.0 runtime unavailable');
  }
  if(req.format==='svg'&&(!req.svg||!existsSync(chrome)))throw Error('SVG contract or Chromium unavailable');
  if(['csv','xml','toml','yaml'].includes(req.format)){
    const result=spawnSync(process.env.ZXBENCH_PYTHON??'python',['-c',`import csv,tomllib,xml.etree.ElementTree${req.format==='yaml'?',yaml;assert yaml.__version__=="6.0.3"':''}`],{timeout:5000,windowsHide:true});
    if(result.status!==0)throw Error('Python 3.11+ format runtime unavailable');
  }
}
const schemaWorker=String.raw`
const fs=require('node:fs'),{createRequire}=require('node:module'),requireCore=createRequire(process.argv[1]);
const input=JSON.parse(fs.readFileSync(0,'utf8')),Ajv=requireCore(input.dialect==='2020-12'?'ajv/dist/2020.js':'ajv').default;
try{
 const scan=(x,depth=0)=>{if(depth>64)throw Error('Schema nesting exceeds published limit');if(x&&typeof x==='object'){if(x.$ref&&!x.$ref.startsWith('#'))throw Error('Only local refs allowed');for(const v of Object.values(x))scan(v,depth+1)}};scan(input.schema);
 const expected=input.dialect==='2020-12'?'https://json-schema.org/draft/2020-12/schema':'http://json-schema.org/draft-07/schema#';
 if(input.schema&&input.schema.$schema&&input.schema.$schema!==expected)throw Error('Wrong dialect');
 const ajv=new Ajv({strict:false,strictNumbers:true,allErrors:false,validateFormats:true,coerceTypes:false,useDefaults:false,removeAdditional:false});requireCore('ajv-formats').default(ajv);
 const v=ajv.compile(input.schema);console.log(JSON.stringify({compiled:true,results:input.cases.map(c=>({valid:!!v(c.data),expected:c.valid}))}));
}catch(e){console.log(JSON.stringify({compiled:false,error:String(e).slice(0,600)}));}`;
const unavailable=(error:unknown):Partial<ScenarioResult>=>({totalScore:0,environmentError:true,humanReviewRequired:true,axisScores:{},
  criterionResults:[{id:'structured_runtime_available',description:'Required runtime available',status:'unmeasured',critical:true,source:'unmeasured',evidence:String(error)}],evidence:[`STRUCTURED_CONTRACT_UNAVAILABLE: ${String(error)}`]});
export const structuredContractV2Evaluator:Evaluator={name:'structured_contract',version:'structured_contract_v2',async evaluate(scenario,output,metadata,response){
  const req=scenario.requirements as unknown as ExtendedContract;
  try{prepareExtendedContract(req);}catch(e){return unavailable(e);}
  let normalized=output,syntaxError='',renderingValid:boolean|undefined;
  if(output.length>131072)syntaxError='Response exceeds published 128 KiB character limit';
  try{
    if(!syntaxError&&['csv','xml','toml','yaml'].includes(req.format)){
      const r=spawnSync(process.env.ZXBENCH_PYTHON??'python',[fileURLToPath(new URL('./structuredFormats.py',import.meta.url))],
        {input:JSON.stringify({format:req.format,text:output}),encoding:'utf8',timeout:3000,maxBuffer:1024*1024,windowsHide:true});
      if(r.error||r.status!==0)return unavailable(r.error??r.stderr);
      const parsed=JSON.parse(r.stdout);if(parsed.ok)normalized=JSON.stringify(parsed.value);else syntaxError=parsed.error;
    }else if(!syntaxError&&req.format==='svg'){
      const parsed=renderStructuredSvg(output,req.svg,chrome);
      if(parsed.ok){normalized=JSON.stringify(parsed.value);renderingValid=parsed.rendered&&parsed.samples.every((p:{pass:boolean})=>p.pass);}
      else {syntaxError=parsed.error;renderingValid=false;}
    }
  }catch(e){return unavailable(e);}
  const base=await structuredContractEvaluator.evaluate({...scenario,requirements:{...req,format:'json'} as never},syntaxError?'':normalized,metadata,response);
  if(base.environmentError)return base;
  const criteria=base.criterionResults!;
  criteria[0]={...criteria[0],id:'structured_raw_format',description:`Entire raw response parses as ${req.format}`,
    evidence:syntaxError||(base.structuredContractMetrics?.syntaxValid?`Original ${req.format} parsed without extraction or repair`:'Invalid raw response')};
  const extra=(id:string,description:string,pass:boolean,evidence:string)=>criteria.push({id:`structured_${id}`,description,status:pass?'pass':'fail',critical:true,source:'verified',evidence} as CriterionResult);
  const metrics=base.structuredContractMetrics!;
  metrics.format=req.format;
  if(req.generatedSchema){
    let compiled=false,passed=false,detail='Invalid raw JSON';
    if(metrics.syntaxValid){
      const python=scenario.graderVersion==='structured_contract_v3';
      const run=spawnSync(python?(process.env.ZXBENCH_PYTHON??'python'):process.execPath,python?[fileURLToPath(new URL('./generatedSchema.py',import.meta.url))]:['--max-old-space-size=128','-e',schemaWorker,fileURLToPath(new URL('../../package.json',import.meta.url))],
        {input:JSON.stringify({schema:JSON.parse(output),cases:req.generatedSchema.cases,dialect:req.dialect}),encoding:'utf8',timeout:3000,maxBuffer:512*1024,windowsHide:true});
      if(run.error && !['ETIMEDOUT','ENOBUFS'].includes((run.error as NodeJS.ErrnoException).code??''))return unavailable(run.error);
      if(run.status===0){const r=JSON.parse(run.stdout);compiled=r.compiled;passed=compiled&&r.results.every((x:{valid:boolean;expected:boolean})=>x.valid===x.expected);detail=compiled?`${r.results.filter((x:{valid:boolean;expected:boolean})=>x.valid===x.expected).length}/${r.results.length} behavioral cases accepted/rejected correctly`:r.error;}
      else detail='Generated schema exceeded bounded compilation/validation runtime';
      if(python)metrics.validator='python-jsonschema@4.26.0 (generated schema); ajv@8.20.0 (outer contract)';
    }
    extra('generated_schema','Generated schema compiles under the declared dialect',compiled,detail);
    extra('schema_behavior','Accept every valid case and reject every invalid case',passed,detail);
    metrics.schemaValid&&=compiled;metrics.contentValid=passed;
  }
  if(renderingValid!==undefined){extra('rendering','SVG renders the declared visible pixels',renderingValid,'Chromium SVG image rasterization and pixel probes');metrics.renderingValid=renderingValid;}
  metrics.complete=criteria.every(c=>c.status==='pass');metrics.partialScore=100*criteria.filter(c=>c.status==='pass').length/criteria.length;
  base.totalScore=base.deterministicScore=metrics.complete?100:0;
  base.evidence=[`STRUCTURED_CONTRACT_RESULT: ${metrics.complete?'pass':'fail'}`,...(!output.trim()?['STRUCTURED_EMPTY_ANSWER: successful request returned no answer']:[])];
  return base;
}};
export const structuredContractV3Evaluator:Evaluator={...structuredContractV2Evaluator,version:'structured_contract_v3'};
