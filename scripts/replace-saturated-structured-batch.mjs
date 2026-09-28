// Promote two existing development cases and add one frozen behavioral case.
// Retire three saturated formal cases. This script makes no model calls.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';

const bp='data/scenarios/benchmark.json',mp='data/scenarios/benchmark-meta.json';
const reportPath='analysis/structured-output-redesign/structured-batch-replacement.json';
const root='data/pilots/structured-contract-frontier-v7';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const manifest=read(`${root}/manifest.json`),gate=read(`${root}/local-gate.json`);
const source=read(`${root}/development.json`),gold=read(`${root}/gold.private.json`);
if(manifest.version!=='structured-contract-frontier-v7-schema-behavior'||gate.status!=='passed'
  ||sha(source)!==manifest.hashes.development||sha(gold)!==manifest.hashes.gold
  ||gate.hashes.development!==manifest.hashes.development||gate.hashes.gold!==manifest.hashes.gold)
  throw Error('Frozen batch case drift');
const candidate=source.find(s=>s.id==='SYN7-BATCH-STRUCTURED');
if(!candidate||candidate.scenarioHash!==hashScenarioShort(candidate)||candidate.requirements.generatedSchema?.cases?.length!==20)
  throw Error('Batch candidate invalid');
const release=read('analysis/structured-output-redesign/development-release.json');
const promotionIds=['SOC2-C-D-1','SOC-D-D2'];
if(!promotionIds.every(id=>release.mixedIds?.includes(id)))throw Error('Mixed-result evidence drift');
const retireIds=['SO-CN-038','SO-CN-043','SO-CN-055'],newId='SOC4-G-BATCH';
const bt=fs.readFileSync(bp,'utf8'),mt=fs.readFileSync(mp,'utf8');
const bank=JSON.parse(bt),meta=JSON.parse(mt),db=new DatabaseSync('apps/data/zxbench.db');
const active=()=>db.prepare("SELECT count(*) n FROM EvalRun WHERE status IN ('running','pending','queued')").get().n;
const bump=(version,part)=>{const v=version.split('.').map(Number);v[part]++;for(let i=part+1;i<v.length;i++)v[i]=0;return v.join('.');};
try{
  if(active())throw Error('An evaluation is active');
  if(bank.some(s=>s.id===newId)||db.prepare('SELECT id FROM ScenarioDefinition WHERE id=?').get(newId))throw Error('New ID exists');
  const formalBefore=bank.filter(s=>s.dimension==='structured_output'&&s.status==='valid'&&!s.requirements?.developmentShadow).length;
  if(formalBefore!==60)throw Error(`Expected 60 formal structured cases, got ${formalBefore}`);
  const prior=[];
  for(const id of [...retireIds,...promotionIds]){
    const s=bank.find(x=>x.id===id),row=db.prepare('SELECT scenarioHash,status FROM ScenarioDefinition WHERE id=?').get(id);
    if(s?.status!=='valid'||row?.status!=='valid'||row.scenarioHash!==s.scenarioHash)throw Error(`Definition drift: ${id}`);
    if(promotionIds.includes(id)!==Boolean(s.requirements?.developmentShadow))throw Error(`Wrong bank tier: ${id}`);
    prior.push({id,oldHash:s.scenarioHash});
    if(retireIds.includes(id)){
      s.status='retired';s.tags=[...new Set([...(s.tags??[]),'retired:structured-saturation-replaced-2026-09-27'])];
      s.scenarioVersion=bump(s.scenarioVersion,2);
    }else{
      delete s.requirements.developmentShadow;
      s.requirements.provenance={...s.requirements.provenance,promotion:'formal structured bank; mixed two-configuration development results; holdout unmeasured',formalRelease:'1.58.0'};
      s.tags=[...new Set([...(s.tags??[]).filter(t=>!['development_shadow','explicit_run_only'].includes(t)),'structured-contract-formal'])];
      s.reviewStatus='verified';s.scenarioVersion=bump(s.scenarioVersion,1);
    }
    s.scenarioHash=hashScenarioShort(s);
  }
  const nextScenario=structuredClone(candidate);
  nextScenario.id=newId;nextScenario.category='contract_challenge_G';nextScenario.difficulty='adversarial';
  nextScenario.reviewStatus='verified';nextScenario.goldSource='local-derived-schema-behavior-v7';nextScenario.goldVerifiedAt=gate.checkedAt;
  nextScenario.tags=[...new Set([...nextScenario.tags,'structured-contract-formal','family:G','behavioral-schema-oracle'])];
  nextScenario.requirements.provenance={sourcePack:'structured-contract-frontier-v7',sourceCaseId:candidate.id,
    sourceCaseHash:candidate.scenarioHash,sourcePackHash:manifest.hashes.development,
    method:'Twenty labeled positive and negative instances checked against an executable JSON Schema',
    limitation:'Development evidence only; no certified cross-model discrimination for this case'};
  nextScenario.scenarioHash=hashScenarioShort(nextScenario);
  const next=[...bank,nextScenario].sort((a,b)=>a.id.localeCompare(b.id,'en'));
  const formalAfter=next.filter(s=>s.dimension==='structured_output'&&s.status==='valid'&&!s.requirements?.developmentShadow).length;
  if(formalAfter!==60)throw Error(`Formal count changed to ${formalAfter}`);
  meta.version=bump(meta.version,1);meta.generatedAt=new Date().toISOString();
  meta.count=next.filter(s=>s.status==='valid').length;meta.validCount=meta.count;
  meta.totalCount++;meta.retiredCount=next.filter(s=>s.status==='retired').length;
  meta.dimensions.structured_output=next.filter(s=>s.dimension==='structured_output'&&s.status==='valid').length;
  meta.retiredDimensions.structured_output=next.filter(s=>s.dimension==='structured_output'&&s.status==='retired').length;
  const dir=`logs/structured-batch-replacement-${Date.now()}`;fs.mkdirSync(dir,{recursive:true});
  await backup(db,`${dir}/before.sqlite`);fs.writeFileSync(`${dir}/benchmark.json`,bt);fs.writeFileSync(`${dir}/benchmark-meta.json`,mt);
  const report={version:meta.version,publishedAt:meta.generatedAt,backup:dir,
    retiredIds:retireIds,promotedIds:promotionIds,addedId:newId,formalBefore,formalAfter,
    totalReplacedIncludingPreviousEvent:4,modelCalls:0,historyPreserved:true,
    prior,addedHash:nextScenario.scenarioHash,sourcePackHash:manifest.hashes.development,
    evidence:['analysis/structured-output-redesign/development-release.json',`${root}/local-gate.json`],
    limitation:'Promoted cases showed mixed development results; batch task has a verified local oracle, without certified model separation.'};
  meta.structuredOutputBatchReplacement={...report,evidencePath:reportPath};
  const columns=new Set(db.prepare('PRAGMA table_info(ScenarioDefinition)').all().map(x=>x.name));
  const jsonFields=new Set(['scoring','hiddenTests','requirements','tags','toolSchema','expectedState','requiredInvariants','allowedActions','forbiddenActions','requiredOrder']);
  db.exec('BEGIN IMMEDIATE');
  try{
    if(active()||fs.readFileSync(bp,'utf8')!==bt||fs.readFileSync(mp,'utf8')!==mt)throw Error('Concurrent publication');
    const update=db.prepare('UPDATE ScenarioDefinition SET status=?,tags=?,requirements=?,reviewStatus=?,scenarioVersion=?,scenarioHash=?,updatedAt=? WHERE id=? AND scenarioHash=? AND status=\'valid\'');
    for(const {id,oldHash} of prior){
      const s=bank.find(x=>x.id===id);
      const result=update.run(s.status,JSON.stringify(s.tags),JSON.stringify(s.requirements),s.reviewStatus,s.scenarioVersion,s.scenarioHash,Date.now(),id,oldHash);
      if(result.changes!==1)throw Error(`Definition changed during publication: ${id}`);
    }
    const row={...nextScenario,createdAt:Date.now(),updatedAt:Date.now()};
    const keys=Object.keys(row).filter(k=>columns.has(k));
    const values=keys.map(k=>jsonFields.has(k)?JSON.stringify(row[k]):k==='goldVerifiedAt'&&row[k]?Date.parse(row[k]):typeof row[k]==='boolean'?Number(row[k]):row[k]??null);
    db.prepare(`INSERT INTO ScenarioDefinition (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...values);
    fs.writeFileSync(bp,JSON.stringify(next,null,1)+'\n');fs.writeFileSync(mp,JSON.stringify(meta,null,1)+'\n');
    fs.mkdirSync('analysis/structured-output-redesign',{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');fs.writeFileSync(bp,bt);fs.writeFileSync(mp,mt);throw error;}
  console.log(JSON.stringify({version:meta.version,retiredIds:retireIds,promotedIds:promotionIds,addedId:newId,formalStructured:formalAfter,backup:dir,modelCalls:0}));
}finally{db.close();}
