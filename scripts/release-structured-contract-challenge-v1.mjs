// Add fourteen prospective formal structured-output cases, preserving history.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';
const root='data/pilots/structured-contract-challenge-v1',bp='data/scenarios/benchmark.json',mp='data/scenarios/benchmark-meta.json';
const reportPath='analysis/structured-output-redesign/challenge-release.json';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const manifest=JSON.parse(fs.readFileSync(`${root}/manifest.json`));
const gate=JSON.parse(fs.readFileSync(`${root}/local-gate.json`));
const candidates=JSON.parse(fs.readFileSync(`${root}/development.json`));
if(candidates.length!==14||sha(candidates)!==manifest.hashes.development||gate.status!=='passed'||
  gate.hashes.development!==manifest.hashes.development||gate.hashes.gold!==manifest.hashes.gold||gate.count!==14)throw Error('Frozen challenge pack gate missing or drifted');
if(candidates.some(s=>s.requirements?.developmentShadow||s.status!=='valid'||s.scenarioHash!==hashScenarioShort(s)))throw Error('Invalid formal candidate');
const apply=process.argv.includes('--apply'),bt=fs.readFileSync(bp,'utf8'),mt=fs.readFileSync(mp,'utf8');
const bank=JSON.parse(bt),meta=JSON.parse(mt),db=new DatabaseSync('apps/data/zxbench.db',{readOnly:!apply});
const active=()=>db.prepare("SELECT count(*) n FROM EvalRun WHERE status IN ('running','pending','queued')").get().n;
try{
  if(candidates.every(s=>bank.find(x=>x.id===s.id)?.scenarioHash===s.scenarioHash&&db.prepare('SELECT scenarioHash FROM ScenarioDefinition WHERE id=?').get(s.id)?.scenarioHash===s.scenarioHash)){
    console.log(JSON.stringify({alreadyPublished:true,count:candidates.length}));
  }else{
    if(active())throw Error('An evaluation is active; publication deferred');
    for(const s of candidates)if(bank.some(x=>x.id===s.id)||db.prepare('SELECT id FROM ScenarioDefinition WHERE id=?').get(s.id))throw Error(`Existing definition: ${s.id}`);
    const oldFormal=bank.filter(s=>s.dimension==='structured_output'&&s.status==='valid'&&!s.requirements?.developmentShadow).length;
    if(oldFormal!==46)throw Error(`Expected 46 current formal structured tasks; found ${oldFormal}`);
    if(!apply)console.log(JSON.stringify({dryRun:true,oldFormal,newFormal:oldFormal+14,ids:candidates.map(s=>s.id)}));
    else{
      const dir=`logs/structured-challenge-release-${Date.now()}`;fs.mkdirSync(dir,{recursive:true});
      await backup(db,`${dir}/before.sqlite`);fs.writeFileSync(`${dir}/benchmark.json`,bt);fs.writeFileSync(`${dir}/benchmark-meta.json`,mt);
      const next=[...bank,...candidates].sort((a,b)=>a.id.localeCompare(b.id,'en'));
      const version=meta.version.split('.').map(Number);version[1]++;version[2]=0;meta.version=version.join('.');meta.generatedAt=new Date().toISOString();
      meta.count=next.filter(s=>s.status==='valid').length;meta.validCount=meta.count;meta.totalCount+=candidates.length;
      meta.dimensions.structured_output=next.filter(s=>s.status==='valid'&&s.dimension==='structured_output').length;
      const formalCount=next.filter(s=>s.status==='valid'&&s.dimension==='structured_output'&&!s.requirements?.developmentShadow).length;
      if(formalCount!==60)throw Error(`Expected exactly 60 formal structured tasks; got ${formalCount}`);
      const report={version:meta.version,releasedAt:meta.generatedAt,backup:dir,added:14,oldFormalCount:oldFormal,formalCount,
        developmentShadowCount:next.filter(s=>s.status==='valid'&&s.dimension==='structured_output'&&s.requirements?.developmentShadow).length,
        ids:candidates.map(s=>s.id),families:Object.fromEntries([...new Set(candidates.map(s=>s.requirements.family))].map(f=>[f,candidates.filter(s=>s.requirements.family===f).length])),
        sourcePackHash:manifest.hashes.development,goldHash:manifest.hashes.gold,modelCalls:0,
        scope:'Prospective formal tasks with deterministic local positive/negative gate; actual model discrimination not yet measured.',
        historicalResultsPreserved:true};
      meta.structuredContractChallenge={...report,evidence:reportPath};
      const columns=new Set(db.prepare('PRAGMA table_info(ScenarioDefinition)').all().map(x=>x.name));
      const jsonFields=new Set(['scoring','hiddenTests','requirements','tags','toolSchema','expectedState','requiredInvariants','allowedActions','forbiddenActions','requiredOrder']);
      db.exec('BEGIN IMMEDIATE');
      try{
        if(active()||fs.readFileSync(bp,'utf8')!==bt||fs.readFileSync(mp,'utf8')!==mt)throw Error('Concurrent publication');
        for(const s of candidates){
          const row={...s,createdAt:Date.now(),updatedAt:Date.now()};
          const keys=Object.keys(row).filter(k=>columns.has(k));
          const values=keys.map(k=>jsonFields.has(k)?JSON.stringify(row[k]):k==='goldVerifiedAt'&&row[k]?Date.parse(row[k]):typeof row[k]==='boolean'?Number(row[k]):row[k]??null);
          db.prepare(`INSERT INTO ScenarioDefinition (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...values);
        }
        fs.writeFileSync(bp,JSON.stringify(next,null,1)+'\n');fs.writeFileSync(mp,JSON.stringify(meta,null,1)+'\n');
        fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');fs.writeFileSync(bp,bt);fs.writeFileSync(mp,mt);throw e;}
      console.log(JSON.stringify({version:meta.version,added:14,formalStructured:formalCount,developmentShadow:report.developmentShadowCount,backup:dir}));
    }
  }
}finally{db.close();}
