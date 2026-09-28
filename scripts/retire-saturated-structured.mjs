// Retire redundant legacy items using saved answers; never delete results or snapshots.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';
import {structuredOutputEvaluator} from '../packages/core/dist/evaluators/structuredOutput.js';
const apply=process.argv.includes('--apply');
const ids=['023','025','029','040','041','042','044','047','048','049','054','057'].map(x=>`SO-CN-${x}`);
const anchors=['001','019','033','035','038','043','055'].map(x=>`SO-CN-${x}`);
const bp='data/scenarios/benchmark.json',mp='data/scenarios/benchmark-meta.json';
const bt=fs.readFileSync(bp,'utf8'),mt=fs.readFileSync(mp,'utf8'),bank=JSON.parse(bt),meta=JSON.parse(mt);
const audit=JSON.parse(fs.readFileSync('analysis/structured-output-redesign/current-checks-audit.json'));
const db=new DatabaseSync('apps/data/zxbench.db',{readOnly:!apply});
const active=()=>db.prepare("SELECT count(*) n FROM EvalRun WHERE status IN ('running','pending','queued')").get().n;
const sha=x=>createHash('sha256').update(x).digest('hex');
const evidence=[];
try{
  if(ids.every(id=>bank.find(s=>s.id===id)?.status==='retired')){
    if(ids.some(id=>db.prepare('SELECT status FROM ScenarioDefinition WHERE id=?').get(id)?.status!=='retired'))throw Error('Retirement drift');
    console.log('Already retired');process.exit(0);
  }
  if(active())throw Error('Active evaluation; do not change selection');
  const runs=audit.runs.map(r=>db.prepare('SELECT id,modelConfigId,manifest FROM EvalRun WHERE id=? AND status=?').get(r.id,'completed'));
  if(runs.length!==8||runs.some(r=>!r)||new Set(runs.map(r=>r.modelConfigId)).size!==8)throw Error('Eight distinct saved configurations required');
  for(const id of ids){
    const s=bank.find(s=>s.id===id),stored=db.prepare('SELECT scenarioHash,status FROM ScenarioDefinition WHERE id=?').get(id);
    if(s?.status!=='valid'||stored?.status!=='valid'||stored.scenarioHash!==s.scenarioHash)throw Error(`Source drift: ${id}`);
    const rows=[];
    for(const run of runs){
      const frozen=JSON.parse(run.manifest).benchmarkPack?.scenarios?.find(x=>x.id===id);
      const row=db.prepare('SELECT modelOutput,totalScore,environmentError,outputMetadata FROM ScenarioResult WHERE evalRunId=? AND scenarioId=?').get(run.id,id);
      if(!row||row.environmentError||!row.modelOutput?.trim()||frozen?.promptTemplate!==s.promptTemplate)throw Error(`Non-comparable answer ${id}/${run.id}`);
      const grade=await structuredOutputEvaluator.evaluate(s,row.modelOutput,{},{});
      if(grade.environmentError||grade.totalScore!==100||!grade.criterionResults?.length||grade.criterionResults.some(c=>c.status!=='pass'))throw Error(`Not saturated: ${id}/${run.id}`);
      rows.push({runId:run.id,modelId:run.modelConfigId,storedScore:row.totalScore,replayedScore:grade.totalScore,
        outputSha256:sha(row.modelOutput),promptSha256:sha(s.promptTemplate),checks:grade.criterionResults.length});
    }
    evidence.push({id,oldHash:s.scenarioHash,oldVersion:s.scenarioVersion,graderVersion:s.graderVersion,rows});
  }
  if(!apply){console.log(JSON.stringify({dryRun:true,retire:ids,keepAnchors:anchors,answersChecked:evidence.length*8}));process.exit(0);}
  const dir=`logs/structured-retirement-${Date.now()}`;fs.mkdirSync(dir,{recursive:true});
  await backup(db,`${dir}/before.sqlite`);fs.writeFileSync(`${dir}/benchmark.json`,bt);fs.writeFileSync(`${dir}/benchmark-meta.json`,mt);
  const historical=db.prepare('SELECT count(*) n,sum(totalScore) scores FROM ScenarioResult').get();
  db.exec('BEGIN IMMEDIATE');
  try{
    if(active()||fs.readFileSync(bp,'utf8')!==bt||fs.readFileSync(mp,'utf8')!==mt)throw Error('Concurrent publication');
    for(const e of evidence){
      const s=bank.find(s=>s.id===e.id);s.status='retired';s.tags=[...new Set([...(s.tags??[]),'retired:structured-saturation-2026-09-26'])];
      const v=s.scenarioVersion.split('.').map(Number);v[2]++;s.scenarioVersion=v.join('.');s.scenarioHash=hashScenarioShort(s);
      const r=db.prepare("UPDATE ScenarioDefinition SET status='retired',tags=?,scenarioVersion=?,scenarioHash=?,updatedAt=? WHERE id=? AND scenarioHash=? AND status='valid'")
        .run(JSON.stringify(s.tags),s.scenarioVersion,s.scenarioHash,Date.now(),s.id,e.oldHash);
      if(r.changes!==1)throw Error(`Definition changed: ${s.id}`);
      e.newHash=s.scenarioHash;
    }
    const v=meta.version.split('.').map(Number);v[1]++;v[2]=0;meta.version=v.join('.');meta.generatedAt=new Date().toISOString();
    meta.count=bank.filter(s=>s.status==='valid').length;meta.validCount=meta.count;meta.retiredCount=bank.filter(s=>s.status==='retired').length;
    meta.dimensions.structured_output=bank.filter(s=>s.dimension==='structured_output'&&s.status==='valid').length;
    meta.retiredDimensions.structured_output=bank.filter(s=>s.dimension==='structured_output'&&s.status==='retired').length;
    meta.structuredOutputCuration={version:meta.version,retiredIds:ids,retainedSaturatedAnchors:anchors,
      evidence:'analysis/structured-output-redesign/retirement-evidence.json',historyPreserved:true};
    fs.writeFileSync(bp,JSON.stringify(bank,null,1)+'\n');fs.writeFileSync(mp,JSON.stringify(meta,null,1)+'\n');db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');fs.writeFileSync(bp,bt);fs.writeFileSync(mp,mt);throw e;}
  const after=db.prepare('SELECT count(*) n,sum(totalScore) scores FROM ScenarioResult').get();
  const report={version:meta.version,createdAt:meta.generatedAt,retired:ids,anchors,evidence,backup:dir,
    modelCalls:0,answersReplayed:96,historyBefore:historical,historyAfter:after,
    limitation:'All implemented legacy checks saturated on eight configurations, not proof of universal task saturation. Seven format anchors retained.'};
  fs.writeFileSync('analysis/structured-output-redesign/retirement-evidence.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({version:meta.version,retired:ids,remainingStructured:meta.dimensions.structured_output,historyUnchanged:JSON.stringify(historical)===JSON.stringify(after),backup:dir}));
}finally{db.close();}
