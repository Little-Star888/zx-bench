import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const ids = ['008','010','012','013','014','015','016','017','018','019','020','021','022','023','024','025','026','027',
  '032','033','034','035','036','037','038','039','041','045','049'].map(n => `SO-CN-${n}`);
const outputPath = 'data/pilots/structured-text-contracts.json';
const bank = JSON.parse(readFileSync('data/scenarios/benchmark.json', 'utf8'));
if (existsSync(outputPath)) {
  const prior = JSON.parse(readFileSync(outputPath, 'utf8'));
  if (prior.length === ids.length && prior.every(s => bank.find(x => x.id === s.id)?.scenarioHash === s.scenarioHash)) {
    console.log(JSON.stringify({ count: ids.length, alreadyReleased: true }));
    process.exit(0);
  }
}
const candidates = ids.map(id => {
  const scenario = structuredClone(bank.find(s => s.id === id));
  if (!scenario || scenario.dimension !== 'structured_output' || scenario.status !== 'valid') throw Error(`Invalid ${id}`);
  scenario.requirements.text_contract = 'v1';
  if (id === 'SO-CN-032') scenario.promptTemplate = scenario.promptTemplate
    .replace('第二段用 *defaultMeta 引用该锚点',
      '在第一段的另一处用 *defaultMeta 引用该锚点；第二段为独立配置，不跨文档引用锚点');
  if (id === 'SO-CN-036') scenario.promptTemplate = scenario.promptTemplate
    .replace('如 --> 与 -->', '如 --> 与 <-->');
  const version = scenario.scenarioVersion.split('.').map(Number);
  version[2]++;
  scenario.scenarioVersion = version.join('.');
  scenario.scenarioHash = hashScenarioShort(scenario);
  return scenario;
});
writeFileSync(outputPath, JSON.stringify(candidates, null, 2) + '\n');
console.log(JSON.stringify({ count: candidates.length, ids }));
