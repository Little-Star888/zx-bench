// Publish the screened development pack, without promoting it into the default bank.
// No inference or answer replay. Frozen hashes and write-time guards protect publication.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';

const root='data/pilots/structured-contract-v2',bp='data/scenarios/benchmark.json',mp='data/scenarios/benchmark-meta.json';
const reportPath='analysis/structured-output-redesign/development-release.json';
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const manifest=JSON.parse(fs.readFileSync(`${root}/manifest.json`));
const gate=JSON.parse(fs.readFileSync(`${root}/local-gate.json`));
const source=JSON.parse(fs.readFileSync(`${root}/development.json`));
if(sha(source)!==manifest.hashes.development||gate.status!=='passed'||gate.packHashes.development!==manifest.hashes.development)throw Error('Frozen development pack drift');
const modelIds=['05c8edd2-6ca6-4c95-9090-e6431b8ab415','26b40562-a005-456a-8010-23f84ff20eb5'];
const results=modelIds.map(id=>JSON.parse(fs.readFileSync(`${root}/calibration-development-${id}.json`)));
for(const r of results)if(r.packHash!==manifest.hashes.development||r.summary.scored!==source.length)throw Error('Incomplete screening evidence');
const mixedIds=source.filter(s=>new Set(results.map(r=>r.rows.find(x=>x.scenarioId===s.id)?.result?.structuredContractMetrics?.complete)).size===2).map(s=>s.id);
const candidates=source.map(s=>{
  const n=structuredClone(s);n.tier='private_validation';n.scenarioVersion='1.1.0';
  if(n.requirements.generatedSchema)n.graderVersion='structured_contract_v3';
  n.requirements.developmentShadow=true;
  n.requirements.provenance={...n.requirements.provenance,sourceCaseHash:s.scenarioHash,sourcePackHash:manifest.hashes.development,
    screening:mixedIds.includes(s.id)?'mixed_on_two_configurations':'passed_on_two_configurations',
    promotion:'development_only; holdout unmeasured; no difficulty certification'};
  n.tags=[...new Set([...n.tags,'structured-contract-development-release','development_shadow','explicit_run_only',
    mixedIds.includes(s.id)?'screening:mixed':'screening:all_pass'])];
  n.scenarioHash=hashScenarioShort(n);return n;
});
const bt=fs.readFileSync(bp,'utf8'),mt=fs.readFileSync(mp,'utf8'),bank=JSON.parse(bt),meta=JSON.parse(mt);
const apply=process.argv.includes('--apply'),db=new DatabaseSync('apps/data/zxbench.db',{readOnly:!apply});
const active=()=>db.prepare("SELECT count(*) n FROM EvalRun WHERE status IN ('running','pending','queued')").get().n;
try{
  if(candidates.every(s=>bank.find(x=>x.id===s.id)?.scenarioHash===s.scenarioHash&&db.prepare('SELECT scenarioHash FROM ScenarioDefinition WHERE id=?').get(s.id)?.scenarioHash===s.scenarioHash)){
    console.log(JSON.stringify({alreadyPublished:true,count:candidates.length}));
  }else{
    if(active())throw Error('An evaluation is active');
    for(const s of candidates)if(bank.some(x=>x.id===s.id)||db.prepare('SELECT id FROM ScenarioDefinition WHERE id=?').get(s.id))throw Error(`Existing definition: ${s.id}`);
    if(!apply)console.log(JSON.stringify({dryRun:true,count:candidates.length,mixedIds,formalPromotions:0}));
    else{
      const dir=`logs/structured-development-release-${Date.now()}`;fs.mkdirSync(dir,{recursive:true});
      await backup(db,`${dir}/before.sqlite`);fs.writeFileSync(`${dir}/benchmark.json`,bt);fs.writeFileSync(`${dir}/benchmark-meta.json`,mt);
      const next=[...bank,...candidates];
      const version=meta.version.split('.').map(Number);version[1]++;version[2]=0;meta.version=version.join('.');meta.generatedAt=new Date().toISOString();
      meta.count=next.filter(s=>s.status==='valid').length;meta.validCount=meta.count;meta.totalCount+=candidates.length;
      meta.dimensions.structured_output=next.filter(s=>s.status==='valid'&&s.dimension==='structured_output').length;
      const formalCount=next.filter(s=>s.status==='valid'&&s.dimension==='structured_output'&&!s.requirements?.developmentShadow).length;
      const report={version:meta.version,releasedAt:meta.generatedAt,backup:dir,modelCalls:0,sourcePackHash:manifest.hashes.development,
        count:candidates.length,formalStructuredCount:formalCount,formalPromotions:0,mixedIds,
        allPassIds:candidates.filter(s=>!mixedIds.includes(s.id)).map(s=>s.id),
        candidates:candidates.map(s=>({id:s.id,scenarioHash:s.scenarioHash,sourceCaseHash:s.requirements.provenance.sourceCaseHash,graderVersion:s.graderVersion})),
        scoringChange:'Generated-schema tasks use v3 for future runs. Saved calibration scores remain the original v2 observations, not v3 scores.',
        holdout:{count:manifest.holdout,hash:manifest.hashes.holdout,modelCalls:0,status:'frozen_unmeasured'},
        policy:'Development-only explicit selection. No automatic evaluation, no historical score rewrites. Further calibration omitted per user request.'};
      meta.structuredContractDevelopment={...report,evidence:reportPath};
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
      console.log(JSON.stringify({version:meta.version,development:candidates.length,formalStructuredCount:formalCount,mixedIds,backup:dir}));
    }
  }
}finally{db.close();}
