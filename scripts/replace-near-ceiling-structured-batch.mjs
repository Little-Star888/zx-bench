// Publish eight stronger contract cases from the frozen v2 pack without model calls.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';

const bp='data/scenarios/benchmark.json',mp='data/scenarios/benchmark-meta.json';
const reportPath='analysis/structured-output-redesign/near-ceiling-batch-replacement.json';
const root='data/pilots/structured-contract-v2';
const pairs=[
  ['SO-CN-003','SOC2-A-H-route'],
  ['SO-CN-030','SOC2-B-H-tree'],
  ['SO-CN-002','SOC2-C-H-headers'],
  ['SO-CN-005','SOC-D-H1'],
  ['SO-CN-050','SOC2-E-H-complex'],
  ['SO-CN-007','SOC2-F-H-csv'],
  ['SO-CN-008','SOC2-F-H-yaml'],
  ['SO-CN-004','SOC2-G-H-1'],
];
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const manifest=read(`${root}/manifest.json`),local=read(`${root}/local-gate.json`),independent=read(`${root}/independent-gate.json`);
const source=read(`${root}/holdout.json`),gold=read(`${root}/holdout-gold.json`);
if(manifest.version!=='structured-contract-v2'||local.status!=='passed'||independent.status!=='passed'
  ||sha(source)!==manifest.hashes.holdout||sha(gold)!==manifest.goldHashes.holdout
  ||local.packHashes.holdout!==manifest.hashes.holdout||independent.packHashes.holdout!==manifest.hashes.holdout
  ||local.goldHashes.holdout!==manifest.goldHashes.holdout||independent.goldHashes.holdout!==manifest.goldHashes.holdout)
  throw Error('Frozen source or gate drift');
const audit=read('analysis/structured-output-redesign/current-checks-audit.json');
const passCounts=Object.fromEntries(pairs.map(([oldId])=>{
  const q=audit.perQuestion.find(x=>x.id===oldId);
  if(!q||q.total!==8||q.pass<6)throw Error(`Near-ceiling evidence absent: ${oldId}`);
  return [oldId,q.pass];
}));
const bt=fs.readFileSync(bp,'utf8'),mt=fs.readFileSync(mp,'utf8');
const bank=JSON.parse(bt),meta=JSON.parse(mt),db=new DatabaseSync('apps/data/zxbench.db');
const active=()=>db.prepare("SELECT count(*) n FROM EvalRun WHERE status IN ('running','pending','queued')").get().n;
const patchVersion=v=>{const a=v.split('.').map(Number);a[2]++;return a.join('.');};
try{
  if(active())throw Error('An evaluation is active');
  const formalBefore=bank.filter(s=>s.dimension==='structured_output'&&s.status==='valid'&&!s.requirements?.developmentShadow).length;
  if(formalBefore!==60)throw Error(`Expected 60 formal cases, got ${formalBefore}`);
  const retired=[],added=[];
  for(const [oldId,newId] of pairs){
    const old=bank.find(s=>s.id===oldId),stored=db.prepare('SELECT scenarioHash,status FROM ScenarioDefinition WHERE id=?').get(oldId);
    const fresh=source.find(s=>s.id===newId);
    if(old?.status!=='valid'||old.dimension!=='structured_output'||stored?.status!=='valid'||stored.scenarioHash!==old.scenarioHash)
      throw Error(`Retirement source drift: ${oldId}`);
    if(!fresh||fresh.scenarioHash!==hashScenarioShort(fresh)||bank.some(s=>s.id===newId)
      ||db.prepare('SELECT id FROM ScenarioDefinition WHERE id=?').get(newId))throw Error(`Candidate invalid or exists: ${newId}`);
    if(!local.rows.some(x=>x.id===newId&&x.correct===100&&x.incorrect===0)
      ||!independent.rows.some(x=>x.id===newId&&x.goldSchemaValid))throw Error(`Candidate gate missing: ${newId}`);
    const oldHash=old.scenarioHash;
    old.status='retired';old.tags=[...new Set([...(old.tags??[]),'retired:structured-near-ceiling-replaced-2026-09-27'])];
    old.scenarioVersion=patchVersion(old.scenarioVersion);old.scenarioHash=hashScenarioShort(old);
    retired.push({id:oldId,oldHash,newHash:old.scenarioHash,historicalPass:passCounts[oldId],historicalTotal:8});
    const s=structuredClone(fresh);
    delete s.requirements.developmentShadow;
    s.tier='private_validation';s.scenarioVersion='1.1.0';s.difficulty='adversarial';
    s.tags=[...new Set([...(s.tags??[]).filter(t=>t!=='split:holdout'),'structured-contract-formal','split:formal'])];
    s.requirements.provenance={...s.requirements.provenance,formerSplit:'holdout',split:'formal',formalRelease:'1.59.0',
      sourcePackHash:manifest.hashes.holdout,limitation:'Former holdout, now formal; development analogs were easy for screened models. No certified difficulty increase.'};
    s.scenarioHash=hashScenarioShort(s);added.push(s);
  }
  const next=[...bank,...added].sort((a,b)=>a.id.localeCompare(b.id,'en'));
  const formalAfter=next.filter(s=>s.dimension==='structured_output'&&s.status==='valid'&&!s.requirements?.developmentShadow).length;
  if(formalAfter!==60)throw Error(`Formal count changed to ${formalAfter}`);
  const version=meta.version.split('.').map(Number);version[1]++;version[2]=0;
  meta.version=version.join('.');meta.generatedAt=new Date().toISOString();
  meta.count=next.filter(s=>s.status==='valid').length;meta.validCount=meta.count;
  meta.totalCount+=added.length;meta.retiredCount=next.filter(s=>s.status==='retired').length;
  meta.dimensions.structured_output=next.filter(s=>s.dimension==='structured_output'&&s.status==='valid').length;
  meta.retiredDimensions.structured_output=next.filter(s=>s.dimension==='structured_output'&&s.status==='retired').length;
  const dir=`logs/structured-near-ceiling-replacement-${Date.now()}`;fs.mkdirSync(dir,{recursive:true});
  await backup(db,`${dir}/before.sqlite`);fs.writeFileSync(`${dir}/benchmark.json`,bt);fs.writeFileSync(`${dir}/benchmark-meta.json`,mt);
  const report={version:meta.version,publishedAt:meta.generatedAt,backup:dir,pairs:pairs.map(([retiredId,addedId])=>({retiredId,addedId,historicalPass:passCounts[retiredId],historicalTotal:8})),
    formalBefore,formalAfter,totalReplacedIncludingPriorBatches:12,modelCalls:0,historyPreserved:true,
    sourcePackHash:manifest.hashes.holdout,sourceGoldHash:manifest.goldHashes.holdout,
    basis:'Former frozen holdout cases have deterministic gold, correct/incorrect local gates and independent JSON Schema gate. Old cases passed 6-7 of 8 historical configurations.',
    limitation:'No new model calibration. The v2 development analogs were all-pass in screened configurations; these replacements strengthen contract specificity but are not proven to lower the score ceiling. Former holdout cases must no longer be treated as an independent holdout.'};
  meta.structuredOutputNearCeilingReplacement={...report,evidencePath:reportPath};
  const columns=new Set(db.prepare('PRAGMA table_info(ScenarioDefinition)').all().map(x=>x.name));
  const jsonFields=new Set(['scoring','hiddenTests','requirements','tags','toolSchema','expectedState','requiredInvariants','allowedActions','forbiddenActions','requiredOrder']);
  db.exec('BEGIN IMMEDIATE');
  try{
    if(active()||fs.readFileSync(bp,'utf8')!==bt||fs.readFileSync(mp,'utf8')!==mt)throw Error('Concurrent publication');
    const retire=db.prepare("UPDATE ScenarioDefinition SET status='retired',tags=?,scenarioVersion=?,scenarioHash=?,updatedAt=? WHERE id=? AND scenarioHash=? AND status='valid'");
    for(const row of retired){const s=bank.find(x=>x.id===row.id);
      if(retire.run(JSON.stringify(s.tags),s.scenarioVersion,s.scenarioHash,Date.now(),row.id,row.oldHash).changes!==1)
        throw Error(`Retirement changed: ${row.id}`);
    }
    for(const s of added){
      const row={...s,createdAt:Date.now(),updatedAt:Date.now()},keys=Object.keys(row).filter(k=>columns.has(k));
      const values=keys.map(k=>jsonFields.has(k)?JSON.stringify(row[k]):k==='goldVerifiedAt'&&row[k]?Date.parse(row[k]):typeof row[k]==='boolean'?Number(row[k]):row[k]??null);
      db.prepare(`INSERT INTO ScenarioDefinition (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...values);
    }
    fs.writeFileSync(bp,JSON.stringify(next,null,1)+'\n');fs.writeFileSync(mp,JSON.stringify(meta,null,1)+'\n');
    fs.mkdirSync('analysis/structured-output-redesign',{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');fs.writeFileSync(bp,bt);fs.writeFileSync(mp,mt);throw error;}
  console.log(JSON.stringify({version:meta.version,replaced:pairs.length,cumulativeReplacements:12,formalStructured:formalAfter,modelCalls:0,backup:dir}));
}finally{db.close();}
