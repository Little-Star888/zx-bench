// Publish the two PostgreSQL rules proven by disposable database fixtures.
import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const apply = process.argv.includes('--apply');
const bankPath = 'data/scenarios/benchmark.json';
const metaPath = 'data/scenarios/benchmark-meta.json';
const oldBank = readFileSync(bankPath,'utf8');
const oldMeta = readFileSync(metaPath,'utf8');
const bank = JSON.parse(oldBank);
const ids = ['SO-CN-013','SO-CN-034'];
const db = new DatabaseSync('apps/data/zxbench.db',{readOnly:!apply});
const active = () => db.prepare("SELECT count(*) n FROM EvalRun WHERE status IN ('running','pending','queued')").get().n;
if (active()) throw Error('Evaluation is active');
const changes = [];
for (const id of ids) {
  const scenario = bank.find(item => item.id === id);
  if (!scenario || scenario.requirements?.text_contract !== 'v1' ||
      !/^\d+\.\d+\.\d+$/.test(scenario.scenarioVersion)) throw Error(`Unexpected scenario ${id}`);
  const stored = db.prepare('SELECT scenarioHash FROM ScenarioDefinition WHERE id=?').get(id);
  if (stored?.scenarioHash !== scenario.scenarioHash) throw Error(`Bank/database drift ${id}`);
  const oldHash = scenario.scenarioHash;
  scenario.requirements.text_contract = 'v2';
  const parts = scenario.scenarioVersion.split('.').map(Number);
  parts[2]++;
  scenario.scenarioVersion = parts.join('.');
  scenario.scenarioHash = hashScenarioShort(scenario);
  changes.push({id,oldHash,newHash:scenario.scenarioHash});
}
if (!apply) { console.log(JSON.stringify({dryRun:true,changes})); db.close(); process.exit(0); }
const dir = `logs/structured-sql-v2-${Date.now()}`;
mkdirSync(dir,{recursive:true});
await backup(db,`${dir}/before.sqlite`);
copyFileSync(bankPath,`${dir}/benchmark.json`);
copyFileSync(metaPath,`${dir}/benchmark-meta.json`);
const meta = JSON.parse(oldMeta);
if (meta.version !== '1.51.0') throw Error(`Unexpected bank version ${meta.version}`);
meta.version = '1.51.1';
meta.generatedAt = new Date().toISOString();
meta.structuredOutputReview.textStructure = {
  ...meta.structuredOutputReview.textStructure,
  version:meta.version,
  postgresRuntimeAudit:{ids,fixtures:['top users versus top orders','restock conflict invariance'],
    report:'data/pilots/structured-postgres-audit.json'},
  note:'Bounded text contracts; two PostgreSQL v2 rules confirmed by isolated execution. HTML browser audit is offline; Mermaid rendering and MySQL execution remain unmeasured.',
};
db.exec('BEGIN IMMEDIATE');
try {
  if (active()) throw Error('Evaluation started before publication');
  const update = db.prepare('UPDATE ScenarioDefinition SET requirements=?,scenarioVersion=?,scenarioHash=?,updatedAt=? WHERE id=?');
  for (const id of ids) {
    const scenario = bank.find(item => item.id === id);
    update.run(JSON.stringify(scenario.requirements),scenario.scenarioVersion,
      scenario.scenarioHash,Date.now(),id);
  }
  writeFileSync(bankPath,JSON.stringify(bank,null,1)+'\n');
  writeFileSync(metaPath,JSON.stringify(meta,null,1)+'\n');
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  writeFileSync(bankPath,oldBank);
  writeFileSync(metaPath,oldMeta);
  throw error;
} finally { db.close(); }
writeFileSync(`${dir}/release.json`,JSON.stringify({version:meta.version,changes,backup:dir,
  releasedAt:meta.generatedAt},null,2)+'\n');
console.log(JSON.stringify({version:meta.version,changes,backup:dir}));
