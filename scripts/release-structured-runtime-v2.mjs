// Publish the MySQL and Mermaid rules proven by target-engine/browser audits.
import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const apply=process.argv.includes('--apply');
const bankPath='data/scenarios/benchmark.json';
const metaPath='data/scenarios/benchmark-meta.json';
const oldBank=readFileSync(bankPath,'utf8'),oldMeta=readFileSync(metaPath,'utf8');
const bank=JSON.parse(oldBank);
const ids=['SO-CN-017','SO-CN-024'];
const db=new DatabaseSync('apps/data/zxbench.db',{readOnly:!apply});
const active=()=>db.prepare("SELECT count(*) n FROM EvalRun WHERE status IN ('running','pending','queued')").get().n;
if(active())throw Error('Evaluation is active');
const changes=[];
for(const id of ids){
  const scenario=bank.find(item=>item.id===id);
  if(!scenario||scenario.requirements?.text_contract!=='v1'||
    !/^\d+\.\d+\.\d+$/.test(scenario.scenarioVersion))throw Error(`Unexpected scenario ${id}`);
  const stored=db.prepare('SELECT scenarioHash FROM ScenarioDefinition WHERE id=?').get(id);
  if(stored?.scenarioHash!==scenario.scenarioHash)throw Error(`Bank/database drift ${id}`);
  const oldHash=scenario.scenarioHash;
  scenario.requirements.text_contract='v2';
  const parts=scenario.scenarioVersion.split('.').map(Number);parts[2]++;
  scenario.scenarioVersion=parts.join('.');
  scenario.scenarioHash=hashScenarioShort(scenario);
  changes.push({id,oldHash,newHash:scenario.scenarioHash});
}
if(!apply){console.log(JSON.stringify({dryRun:true,changes}));db.close();process.exit(0);}
const dir=`logs/structured-runtime-v2-${Date.now()}`;
mkdirSync(dir,{recursive:true});
await backup(db,`${dir}/before.sqlite`);
copyFileSync(bankPath,`${dir}/benchmark.json`);
copyFileSync(metaPath,`${dir}/benchmark-meta.json`);
const meta=JSON.parse(oldMeta);
if(meta.version!=='1.51.1')throw Error(`Unexpected bank version ${meta.version}`);
meta.version='1.51.2';
meta.generatedAt=new Date().toISOString();
meta.structuredOutputReview.textStructure={...meta.structuredOutputReview.textStructure,
  version:meta.version,
  mysqlRuntimeAudit:{id:'SO-CN-017',image:'mysql:8.4.11',report:'data/pilots/structured-mysql-audit.json'},
  mermaidRenderAudit:{id:'SO-CN-024',version:'11.17.2',report:'data/pilots/structured-mermaid-render-audit.json'},
  htmlMobileAudit:{viewports:[390,1280],report:'data/pilots/structured-html-mobile-audit.json',scored:false},
  note:'Bounded text contracts; PostgreSQL, MySQL, and Mermaid browser audits completed. Confirmed syntax defects feed versioned rules; browser layout observations are not scored beyond task requirements.',
};
db.exec('BEGIN IMMEDIATE');
try{
  if(active())throw Error('Evaluation started before publication');
  const update=db.prepare('UPDATE ScenarioDefinition SET requirements=?,scenarioVersion=?,scenarioHash=?,updatedAt=? WHERE id=?');
  for(const id of ids){const scenario=bank.find(item=>item.id===id);
    update.run(JSON.stringify(scenario.requirements),scenario.scenarioVersion,
      scenario.scenarioHash,Date.now(),id);}
  writeFileSync(bankPath,JSON.stringify(bank,null,1)+'\n');
  writeFileSync(metaPath,JSON.stringify(meta,null,1)+'\n');
  db.exec('COMMIT');
}catch(error){db.exec('ROLLBACK');writeFileSync(bankPath,oldBank);
  writeFileSync(metaPath,oldMeta);throw error;
}finally{db.close();}
writeFileSync(`${dir}/release.json`,JSON.stringify({version:meta.version,changes,backup:dir,
  releasedAt:meta.generatedAt},null,2)+'\n');
console.log(JSON.stringify({version:meta.version,changes,backup:dir}));
