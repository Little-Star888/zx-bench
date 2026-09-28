import fs from 'node:fs';import{createHash}from'node:crypto';
import{prepareStructuredContract}from'../packages/core/dist/evaluators/structuredContract.js';
import{prepareExtendedContract}from'../packages/core/dist/evaluators/structuredContractV2.js';
const root='data/pilots/structured-contract-v2/standard-suite',manifest=JSON.parse(fs.readFileSync(`${root}/manifest.json`));
const report={revision:manifest.revision,checked:0,passed:0,unsupportedGroups:[],mismatches:[],modelCalls:0};
for(const file of manifest.sources){
 const raw=fs.readFileSync(`${root}/${file.path}`);
 if(createHash('sha256').update(raw).digest('hex')!==file.sha256)throw Error('Source drift');
 if(!file.path.endsWith('.json'))continue;
 const dialect=file.path.includes('draft7')?'draft-07':'2020-12';
 for(const group of JSON.parse(raw)){
  let v;
  try{const req={format:'json',dialect,schema:group.schema,formatAssertions:true,family:'standard-tests',output_policy:'raw_only'};prepareExtendedContract(req);v=prepareStructuredContract(req).schema;}
  catch(e){report.unsupportedGroups.push({file:file.path,description:group.description,reason:String(e)});continue;}
  for(const t of group.tests){report.checked++;try{const actual=!!v(t.data);if(actual!==t.valid)report.mismatches.push({file:file.path,group:group.description,test:t.description,actual,expected:t.valid,schema:group.schema,data:t.data});else report.passed++;}catch(e){report.mismatches.push({file:file.path,group:group.description,test:t.description,error:String(e),schema:group.schema,data:t.data});}}
 }
}
report.status=report.mismatches.length?'mismatch-found':'passed-for-admitted-schemas';
report.scope='Four feature files only. Strict admission rejects unused/unknown keywords; excluded groups are disclosed, not counted as passes.';
fs.writeFileSync(`${root}/audit.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
