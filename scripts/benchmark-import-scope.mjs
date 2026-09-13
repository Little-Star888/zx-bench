import fs from 'node:fs';
import path from 'node:path';

/** Build the released import plan without contacting a running server. */
export function loadBenchmarkImportScope(scenariosDir) {
  const benchmarkPath = path.join(scenariosDir, 'benchmark.json');
  const scenarios = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));
  if (!Array.isArray(scenarios) || scenarios.some((scenario) => !scenario?.id)) {
    throw new Error('benchmark.json 不是有效的题目数组');
  }
  const benchmarkIds = new Set(scenarios.map((scenario) => scenario.id));
  if (benchmarkIds.size !== scenarios.length) throw new Error('benchmark.json 含重复题号');

  const accidentalBundledIds = new Set();
  for (const file of fs.readdirSync(scenariosDir).filter((name) => name.endsWith('.json') && name !== 'benchmark.json')) {
    const value = JSON.parse(fs.readFileSync(path.join(scenariosDir, file), 'utf8'));
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (item?.id && !benchmarkIds.has(item.id)) accidentalBundledIds.add(item.id);
    }
  }
  return { scenarios, benchmarkIds, accidentalBundledIds };
}
