// One-for-one formal-bank replacement. No model calls or answer replay.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';

const root='data/pilots/structured-contract-frontier-v8';
const bp='data/scenarios/benchmark.json',mp='data/scenarios/benchmark-meta.json';
const reportPath='analysis/structured-output-redesign/event-schema-replacement.json';
const retiredId='SO-CN-001',newId='SOC4-G-EVENT';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const manifest=read(`${root}/manifest.json`),gate=read(`${root}/local-gate.json`);
const source=read(`${root}/development.json`),gold=read(`${root}/gold.private.json`);
if(manifest.version!=='structured-contract-frontier-v8-order-control'||gate.status!=='passed'
  ||sha(source)!==manifest.hashes.development||sha(gold)!==manifest.hashes.gold
  ||gate.hashes.development!==manifest.hashes.development||gate.hashes.gold!==manifest.hashes.gold)
  throw Error('Frozen event schema evidence drift');
const candidate=source.find(s=>s.id==='SYN8-EVENT-STRUCTURED');
if(!candidate||candidate.scenarioHash!==hashScenarioShort(candidate)||candidate.requirements.generatedSchema?.cases?.length!==20)
  throw Error('Invalid candidate');
const bonsai=read(`${root}/calibration-development-ed16d154-f5e9-4650-b355-cf5418846b81-bonsai2-no-reason-order-control.json`);
const qwen=read(`${root}/calibration-development-05c8edd2-6ca6-4c95-9090-e6431b8ab415-qwen38-order-control.json`);
for(const artifact of [bonsai,qwen])if(artifact.packHash!==manifest.hashes.development||artifact.rows.length!==2)
  throw Error('Incomplete frozen paired result');
const passed=(artifact,variant)=>artifact.rows.find(r=>r.scenarioId===`SYN8-EVENT-${variant}`)?.result?.structuredContractMetrics?.complete;
if(!passed(bonsai,'BASE')||passed(bonsai,'STRUCTURED')!==false||!passed(qwen,'BASE')||!passed(qwen,'STRUCTURED'))
  throw Error('Paired discrimination evidence changed');

const bt=fs.readFileSync(bp,'utf8'),mt=fs.readFileSync(mp,'utf8');
const bank=JSON.parse(bt),meta=JSON.parse(mt),db=new DatabaseSync('apps/data/zxbench.db');
const active=()=>db.prepare("SELECT count(*) n FROM EvalRun WHERE status IN ('running','pending','queued')").get().n;
try{
  if(bank.some(s=>s.id===newId)||db.prepare('SELECT id FROM ScenarioDefinition WHERE id=?').get(newId))throw Error('New ID already exists');
  if(active())throw Error('An evaluation is active');
  const old=bank.find(s=>s.id===retiredId),stored=db.prepare('SELECT scenarioHash,status FROM ScenarioDefinition WHERE id=?').get(retiredId);
  if(old?.status!=='valid'||stored?.status!=='valid'||stored.scenarioHash!==old.scenarioHash)throw Error('Retirement source drift');
  const oldFormal=bank.filter(s=>s.dimension==='structured_output'&&s.status==='valid'&&!s.requirements?.developmentShadow).length;
  if(oldFormal!==60)throw Error(`Expected 60 formal structured cases, got ${oldFormal}`);
  const priorHash=old.scenarioHash;
  old.status='retired';old.tags=[...new Set([...(old.tags??[]),'retired:structured-saturation-replaced-2026-09-26'])];
  const oldVersion=old.scenarioVersion.split('.').map(Number);oldVersion[2]++;old.scenarioVersion=oldVersion.join('.');old.scenarioHash=hashScenarioShort(old);
  const nextScenario=structuredClone(candidate);
  nextScenario.id=newId;nextScenario.category='contract_challenge_G';nextScenario.difficulty='adversarial';
  nextScenario.reviewStatus='verified';nextScenario.goldSource='local-derived-schema-behavior-v8';nextScenario.goldVerifiedAt=gate.checkedAt;
  nextScenario.tags=[...new Set([...nextScenario.tags,'structured-contract-formal','family:G','behavioral-schema-oracle'])];
  nextScenario.requirements.provenance={sourcePack:'structured-contract-frontier-v8',sourceCaseId:candidate.id,
    sourceCaseHash:candidate.scenarioHash,sourcePackHash:manifest.hashes.development,
    method:'Twenty interleaved labeled cases and executable-schema behavioral validation',
    evidence:'Bonsai2 base pass/schema 17 of 20; Qwen3.8 base pass/schema 20 of 20',
    limitation:'Development pair only; Bonsai2 reasoning disabled, Qwen3.8 original Unsloth configuration'};
  nextScenario.scenarioHash=hashScenarioShort(nextScenario);
  const next=[...bank,nextScenario].sort((a,b)=>a.id.localeCompare(b.id,'en'));
  const formal=next.filter(s=>s.dimension==='structured_output'&&s.status==='valid'&&!s.requirements?.developmentShadow).length;
  if(formal!==60)throw Error(`Formal count changed to ${formal}`);
  const version=meta.version.split('.').map(Number);version[1]++;version[2]=0;
  meta.version=version.join('.');meta.generatedAt=new Date().toISOString();
  meta.count=next.filter(s=>s.status==='valid').length;meta.validCount=meta.count;
  meta.totalCount++;meta.retiredCount=next.filter(s=>s.status==='retired').length;
  meta.dimensions.structured_output=next.filter(s=>s.dimension==='structured_output'&&s.status==='valid').length;
  meta.retiredDimensions.structured_output=next.filter(s=>s.dimension==='structured_output'&&s.status==='retired').length;
  const dir=`logs/structured-event-replacement-${Date.now()}`;fs.mkdirSync(dir,{recursive:true});
  await backup(db,`${dir}/before.sqlite`);fs.writeFileSync(`${dir}/benchmark.json`,bt);fs.writeFileSync(`${dir}/benchmark-meta.json`,mt);
  const report={version:meta.version,publishedAt:meta.generatedAt,backup:dir,retiredId,retiredOldHash:priorHash,
    retiredNewHash:old.scenarioHash,addedId:newId,addedHash:nextScenario.scenarioHash,
    sourceCaseId:candidate.id,sourcePackHash:manifest.hashes.development,formalBefore:oldFormal,formalAfter:formal,
    modelCalls:0,historyPreserved:true,reason:'Replace one eight-configuration saturated easy JSON item with a behaviorally scored conditional Schema task that showed a paired failure on Bonsai2.',
    evidence:{bonsai:`${root}/calibration-development-ed16d154-f5e9-4650-b355-cf5418846b81-bonsai2-no-reason-order-control.json`,
      qwen:`${root}/calibration-development-05c8edd2-6ca6-4c95-9090-e6431b8ab415-qwen38-order-control.json`},
    limitation:'Only one task family; no claim about overall bank-level ceiling or quantization causality.'};
  meta.structuredOutputReplacement={...report,evidencePath:reportPath};
  const columns=new Set(db.prepare('PRAGMA table_info(ScenarioDefinition)').all().map(x=>x.name));
  const jsonFields=new Set(['scoring','hiddenTests','requirements','tags','toolSchema','expectedState','requiredInvariants','allowedActions','forbiddenActions','requiredOrder']);
  db.exec('BEGIN IMMEDIATE');
  try{
    if(active()||fs.readFileSync(bp,'utf8')!==bt||fs.readFileSync(mp,'utf8')!==mt)throw Error('Concurrent publication');
    const update=db.prepare("UPDATE ScenarioDefinition SET status='retired',tags=?,scenarioVersion=?,scenarioHash=?,updatedAt=? WHERE id=? AND scenarioHash=? AND status='valid'")
      .run(JSON.stringify(old.tags),old.scenarioVersion,old.scenarioHash,Date.now(),retiredId,priorHash);
    if(update.changes!==1)throw Error('Retirement definition changed');
    const row={...nextScenario,createdAt:Date.now(),updatedAt:Date.now()};
    const keys=Object.keys(row).filter(k=>columns.has(k));
    const values=keys.map(k=>jsonFields.has(k)?JSON.stringify(row[k]):k==='goldVerifiedAt'&&row[k]?Date.parse(row[k]):typeof row[k]==='boolean'?Number(row[k]):row[k]??null);
    db.prepare(`INSERT INTO ScenarioDefinition (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...values);
    fs.writeFileSync(bp,JSON.stringify(next,null,1)+'\n');fs.writeFileSync(mp,JSON.stringify(meta,null,1)+'\n');
    fs.mkdirSync('analysis/structured-output-redesign',{recursive:true});
    fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');fs.writeFileSync(bp,bt);fs.writeFileSync(mp,mt);throw error;}
  console.log(JSON.stringify({version:meta.version,retiredId,addedId:newId,formalStructured:formal,backup:dir,modelCalls:0}));
}finally{db.close();}
