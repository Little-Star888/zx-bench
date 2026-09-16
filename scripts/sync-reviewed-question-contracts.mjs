// Canonical, transactional local sync. Never updates ScenarioResult or EvalRun.
// node scripts/sync-reviewed-question-contracts.mjs /path/to/database [--apply]
import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';
const path=process.argv[2];
if(!path)throw Error('Database path required');
const apply=process.argv.includes('--apply');
const executionReview=process.argv.includes('--execution-review');
const allDefinitions=process.argv.includes('--all-definitions');
const bank=JSON.parse(readFileSync(new URL('../data/scenarios/benchmark.json',import.meta.url),'utf8'));
const reviewed=allDefinitions?bank:bank.filter(s=>executionReview?['code_repair','instruction_checklist','llm_judge','pr_executable_evidence'].includes(s.grader):['reasoning_math','hallucination_resistance','data_extraction'].includes(s.dimension)).filter(s=>s.status==='valid');
const meta=JSON.parse(readFileSync(new URL('../data/scenarios/benchmark-meta.json',import.meta.url),'utf8'));
// meta.dimensions counts valid scenarios only, and retired entries deliberately stay in
// benchmark.json for audit; the all-definitions scope therefore sizes against bank.length.
const expectedCount=allDefinitions?bank.length:executionReview?171:['reasoning_math','hallucination_resistance','data_extraction'].reduce((n,d)=>n+meta.dimensions[d],0);
if(reviewed.length!==expectedCount || reviewed.some(s=>s.scenarioHash!==hashScenarioShort(s)))throw Error('Invalid reviewed bank count/hash');
const db=new DatabaseSync(path,{readOnly:!apply});
const columns=new Set(db.prepare('PRAGMA table_info(ScenarioDefinition)').all().map(c=>c.name));
const serialized=new Set(['requirements','scoring','hiddenTests','publicTests','tags']);
// responseMode / maxReasoningTokens participate in the canonical content hash
// (contracts/canonicalize.ts HASH_FIELDS). Omitting them here left the ultra
// progressive-exam rows unable to pass checkScenarioEligibility: the bank hash was
// computed with them set while the database row kept NULL, so every recomputation
// from the stored row mismatched and official runs rejected the whole block.
const keep=['id','dimension','category','difficulty','language','locale','status','tier','promptTemplate','grader','graderVersion','scoring','requirements','scenarioVersion','scenarioHash','reviewStatus','goldSource','goldVerifiedAt','outputPolicy','responseMode','maxAnswerTokens','maxReasoningTokens','createdAt','updatedAt'];
const allKeep=['id','dimension','category','difficulty','language','locale','status','tier','promptTemplate','sourceCode','functionName','expectedVerdict','grader','graderVersion','scoring','hiddenTests','requirements','tags','scenarioVersion','scenarioHash','responseMode','outputPolicy','environmentImage','seed','goldSource','goldVerifiedAt','reviewStatus','answerFirst','maxAnswerTokens','maxReasoningTokens','createdAt','updatedAt'];
const before={results:db.prepare('SELECT count(*) n FROM ScenarioResult').get().n,runs:db.prepare('SELECT count(*) n FROM EvalRun').get().n};
const active=db.prepare("SELECT count(*) n FROM EvalRun WHERE status IN ('running','pending','queued')").get().n;
if(!apply){console.log(JSON.stringify({dryRun:true,count:reviewed.length,before,active,scope:allDefinitions?'all-definitions':executionReview?'execution-review':'reviewed-dimensions'}));db.close();process.exit(0);}
if(active)throw Error('Refusing definition update while a run is active');
const historyHashes=()=>Object.fromEntries(['ScenarioResult','EvalRun'].map(table=>{
 const digest=createHash('sha256');
 for(const row of db.prepare(`SELECT * FROM ${table} ORDER BY id`).iterate())digest.update(JSON.stringify(row)+'\n');
 return [table,digest.digest('hex')];
}));
const historicalBefore=historyHashes();
const backupPath=path+'.reviewed-'+Date.now()+'.bak';
await backup(db,backupPath);
db.exec('BEGIN IMMEDIATE');
try{
 // Recheck under the write lock: a run might start while the backup is made.
 if(db.prepare("SELECT count(*) n FROM EvalRun WHERE status IN ('running','pending','queued')").get().n)throw Error('Run started before definition update');
 if(JSON.stringify(historyHashes())!==JSON.stringify(historicalBefore))throw Error('History changed before definition update');
 for(const s of reviewed){
  const keys=(allDefinitions?allKeep:executionReview?[...keep,'sourceCode','functionName','expectedVerdict','hiddenTests','responseMode','environmentImage','seed','answerFirst','maxReasoningTokens']:keep).filter(k=>columns.has(k));
  const values=keys.map(k=>['createdAt','updatedAt'].includes(k)?Date.now():s[k]==null?null:serialized.has(k)?JSON.stringify(s[k]):k==='goldVerifiedAt'?new Date(s[k]).getTime():typeof s[k]==='boolean'?Number(s[k]):s[k]);
  const update=keys.filter(k=>k!=='id'&&k!=='createdAt').map(k=>`"${k}"=excluded."${k}"`).join(',');
  db.prepare(`INSERT INTO ScenarioDefinition (${keys.map(k=>'"'+k+'"').join(',')}) VALUES (${keys.map(()=>'?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${update}`).run(...values);
 }
 if(!executionReview)db.prepare("UPDATE ScenarioDefinition SET status='retired' WHERE dimension='hallucination_resistance' AND id LIKE 'HAL-%'").run();
 const after={results:db.prepare('SELECT count(*) n FROM ScenarioResult').get().n,runs:db.prepare('SELECT count(*) n FROM EvalRun').get().n};
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Historical row counts changed');
 const historicalAfter=historyHashes();
 if(JSON.stringify(historicalBefore)!==JSON.stringify(historicalAfter))throw Error('Historical contents changed');
 db.exec('COMMIT');console.log(JSON.stringify({applied:reviewed.length,backupPath,before,after,historyHashes:historicalAfter}));
}catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
