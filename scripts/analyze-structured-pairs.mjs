// Interpret frozen paired calibration without further model calls.
import fs from 'node:fs';

const path = process.argv[2], root = process.argv[3] ?? 'data/pilots/structured-contract-frontier-v5';
if (!path) throw Error('Usage: node scripts/analyze-structured-pairs.mjs <calibration-artifact.json> [pack-directory] [additional-artifact.json...]');
const artifacts = [path, ...process.argv.slice(4)].map(file => ({file, data: JSON.parse(fs.readFileSync(file, 'utf8'))}));
const artifact = artifacts[0].data;
for (const {data} of artifacts.slice(1))
  if (data.modelId !== artifact.modelId || data.servedModelId !== artifact.servedModelId
    || data.configHash !== artifact.configHash || data.packHash !== artifact.packHash || data.goldHash !== artifact.goldHash)
    throw Error('Paired artifacts have different frozen model, config, or pack');
const pack = JSON.parse(fs.readFileSync(`${root}/${artifact.split}.json`, 'utf8'));
const scenarios = new Map(pack.map(s => [s.id, s]));
const byPair = new Map();
for (const row of artifacts.flatMap(x => x.data.rows)) {
  const scenario = scenarios.get(row.scenarioId);
  if (!scenario) throw Error(`Unknown scenario ${row.scenarioId}`);
  const id = scenario.requirements.pairId;
  const entry = byPair.get(id) ?? {};
  entry[scenario.requirements.pairVariant] = row;
  byPair.set(id, entry);
}
const results = [];
for (const [pairId, entry] of byPair) {
  const base = entry.base, structured = entry.structured;
  const measured = row => row?.status === 'completed' && !row.result?.environmentError;
  const passed = row => measured(row) && row.result?.structuredContractMetrics?.complete === true;
  let verdict = 'incomplete';
  if (measured(base) && measured(structured)) {
    verdict = passed(base) && !passed(structured) ? 'structured_specific_candidate' :
      !passed(base) && !passed(structured) ? 'source_reasoning_or_shared_failure' :
      passed(base) && passed(structured) ? 'saturated' : 'prompt_sensitivity';
  }
  results.push({pairId, verdict, base: {status: base?.status ?? 'not_run', complete: passed(base),
    metrics: base?.result?.structuredContractMetrics}, structured: {status: structured?.status ?? 'not_run',
    complete: passed(structured), metrics: structured?.result?.structuredContractMetrics}});
}
const report = {modelId: artifact.modelId, split: artifact.split, artifacts: artifacts.map(x => x.file), pairs: results,
  interpretation: artifact.split === 'holdout' ?
    'Source-disjoint paired holdout result. Release still requires coverage across more than one capability family and source-license review.' :
    'A structured-specific development candidate needs source-disjoint holdout before release.'};
console.log(JSON.stringify(report, null, 2));
