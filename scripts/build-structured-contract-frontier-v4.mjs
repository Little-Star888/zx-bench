// Adapt a small fixed split of official SOB text records. No model calls.
// Source: https://huggingface.co/datasets/interfaze-ai/sob (text test split).
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';
const root='data/pilots/structured-contract-frontier-v4';
const source='data/pilots/sob-source/rows-0-99.json';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const shaBytes=x=>createHash('sha256').update(x).digest('hex');
const raw=fs.readFileSync(source),download=JSON.parse(raw),byIndex=new Map(download.rows.map(x=>[x.row_idx,x.row]));
const selections={development:[55,2,7,9,27,28,29,51],holdout:[90,96,98,32]};
const bank=[],oracles={},gold=[];
function paths(value,path='',out=[]){
  if(Array.isArray(value))value.forEach((v,i)=>paths(v,`${path}/${i}`,out));
  else if(value&&typeof value==='object')for(const [key,v] of Object.entries(value))paths(v,`${path}/${key.replaceAll('~','~0').replaceAll('/','~1')}`,out);
  else out.push(path);
  return out;
}
for(const [split,indices] of Object.entries(selections))for(const index of indices){
  const row=byIndex.get(index);if(!row)throw Error(`Missing official row ${index}`);
  if(row.question_difficulty!=='hard')throw Error(`Row ${index} is not official hard`);
  const id=`SOC4-SOB-${String(index).padStart(3,'0')}`;
  const schema=JSON.parse(row.json_schema),expected=JSON.parse(row.ground_truth);
  const sourceId=`hotpotqa:${row.source_id}`;
  const oracle={expected,sources:{[sourceId]:row.context},provenance:Object.fromEntries(paths(expected).map(p=>[p,[sourceId]])),
    ...(index===55?{allowed:{'/company_type':['car rental']}}:{})};
  const req={format:'json',dialect:'2020-12',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',...schema},
    formatAssertions:true,family:`sob_${row.question_type}`,challengeFamily:`SOB_${row.question_type.toUpperCase()}`,
    sourceGroup:row.source_id,output_policy:'raw_only',oracleSet:'frontier-v4',oracleRef:id,oracleHash:sha(oracle),
    provenance:{sourcePack:'interfaze-ai/sob',recordId:row.record_id,sourceId:row.source_id,sourceDataset:row.source_dataset,
      originalLicense:'HotpotQA CC-BY-SA-4.0; SOB code MIT',adaptation:'Text context, question, Schema, ground truth; zxbench raw JSON direct generation'}};
  const prompt=`Read the source context and answer the question. Fill every required field in the JSON Schema from the source; keep names, dates and numbers precise. Do not invent unsupported values.\n\nSource context:\n${row.context}\n\nQuestion:\n${row.question}\n\nJSON Schema:\n${JSON.stringify(req.schema)}\n\nReturn only one complete JSON object. No Markdown fence or explanation.`;
  const scenario={id,dimension:'structured_output',category:'frontier_real_text_multihop',difficulty:'adversarial',language:'json',
    locale:'en-US',status:'valid',tier:'private_validation',promptTemplate:prompt,grader:'structured_contract',
    graderVersion:'structured_contract_v4',scenarioVersion:'1.0.0',scoring:{type:'schema_compliance'},requirements:req,
    outputPolicy:'raw_only',reviewStatus:'unreviewed',goldSource:'official-sob-ground-truth-provisional-local-adjudication',
    goldVerifiedAt:null,tags:['structured-contract-frontier-v4','official-source-adapted','development_only']};
  scenario.scenarioHash=hashScenarioShort(scenario);
  bank.push({split,scenario});oracles[id]=oracle;gold.push({id,split,raw:JSON.stringify(expected),recordId:row.record_id});
}
const development=bank.filter(x=>x.split==='development').map(x=>x.scenario);
const holdout=bank.filter(x=>x.split==='holdout').map(x=>x.scenario);
if(new Set(bank.map(x=>x.scenario.requirements.sourceGroup)).size!==bank.length)throw Error('Source ID overlap');
const manifest={version:'structured-contract-frontier-v4-sob',status:'development-only',
  counts:{development:development.length,holdout:holdout.length},
  source:{dataset:'interfaze-ai/sob',url:'https://huggingface.co/datasets/interfaze-ai/sob',split:'test',
    sourceDataset:'HotpotQA',license:'CC-BY-SA-4.0',sobCodeLicense:'MIT',downloadedRows:'0-99',downloadSha256:shaBytes(raw),
    rowIndices:selections},
  splitPolicy:'Distinct original HotpotQA source_id across selected rows; public benchmark may be contaminated in model training. Fixed indices selected before model calls.',
  goldPolicy:'Official ground_truth values, exact leaf scoring with one adjudicated company_type alias for row 55. This row was used to repair the rubric and is not unbiased discrimination evidence. Further aliases require versioned manual adjudication before promotion.',
  hashes:{development:sha(development),holdout:sha(holdout),oracle:sha(oracles),gold:sha(gold)},modelCalls:0};
fs.mkdirSync(root,{recursive:true});
for(const [name,value] of Object.entries({'development.json':development,'holdout.json':holdout,'oracle.private.json':oracles,
  'gold.private.json':gold,'manifest.json':manifest}))fs.writeFileSync(`${root}/${name}`,JSON.stringify(value,null,2)+'\n');
fs.writeFileSync(`${root}/LICENSE-NOTICE.md`,`# Source attribution\n\nThis locally adapted evaluation pack uses records ${[...selections.development,...selections.holdout].join(', ')} from [Structured Output Benchmark](https://huggingface.co/datasets/interfaze-ai/sob), whose text records derive from [HotpotQA](https://hotpotqa.github.io/). The SOB repository is MIT licensed; source HotpotQA material remains CC BY-SA 4.0. The adaptation selects records and wraps their context, question, schema and validated ground truth in zxbench's grading format. Preserve attribution and the source license for any redistributed task text.\n`);
console.log(JSON.stringify({development:development.length,holdout:holdout.length,indices:selections,hashes:manifest.hashes}));
