// Inspect saved model answers without new calls. Report only mismatch locations.
import fs from 'node:fs';
const artifactPath = process.argv[2];
if (!artifactPath) throw Error('Usage: node scripts/analyze-structured-escape.mjs <calibration-artifact.json>');
const root = process.argv[3] ?? 'data/pilots/structured-contract-escape-v1';
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const pack = [...JSON.parse(fs.readFileSync(`${root}/development.json`, 'utf8')),
  ...JSON.parse(fs.readFileSync(`${root}/holdout.json`, 'utf8'))];
const scenarios = new Map(pack.map(s => [s.id, s]));
const result = [];
for (const row of artifact.rows) {
  const scenario = scenarios.get(row.scenarioId);
  if (!scenario) throw Error(`Unknown scenario ${row.scenarioId}`);
  const assertion = scenario.requirements.assertions[0];
  let data;
  try { data = JSON.parse(row.result?.modelOutput ?? ''); } catch { data = null; }
  const key = assertion.pointer.slice(1), expected = assertion.expected, actual = data?.[key];
  const differences = [];
  if (typeof actual === 'string') {
    let i = 0, j = 0;
    while (i < expected.length && j < actual.length) {
      if (expected[i] === actual[j]) { i++; j++; continue; }
      if (i + 1 < expected.length && expected[i + 1] === actual[j]) {
        differences.push({position: i, kind: 'omitted_expected_character', codePoint: expected.codePointAt(i)}); i++; continue;
      }
      differences.push({position: i, kind: 'substituted_character', expectedCodePoint: expected.codePointAt(i),
        actualCodePoint: actual.codePointAt(j)}); i++; j++;
      if (differences.length >= 12) break;
    }
    while (i < expected.length && differences.length < 12) {
      differences.push({position: i, kind: 'omitted_expected_character', codePoint: expected.codePointAt(i++)});
    }
  }
  result.push({id: row.scenarioId, status: row.status, complete: row.result?.structuredContractMetrics?.complete ?? false,
    syntaxValid: row.result?.structuredContractMetrics?.syntaxValid ?? false,
    schemaValid: row.result?.structuredContractMetrics?.schemaValid ?? false,
    tokenCorrect: actual === expected, expectedLength: expected.length,
    actualLength: typeof actual === 'string' ? actual.length : null, differences});
}
console.log(JSON.stringify({model: artifact.modelName, results: result}, null, 2));
