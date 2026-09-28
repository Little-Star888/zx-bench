import fs from 'node:fs';

const source = JSON.parse(fs.readFileSync('data/scenarios/benchmark.json', 'utf8'));
const safety = new Set([
  1, 2, 3, 4, 6, 7, 8, 20, 22, 23, 24, 25, 26, 27, 28,
  31, 32, 33, 35, 36, 37, 38, 39, 40, 41, 42, 44, 45, 46, 48, 49, 50,
].map((n) => `SA-CN-${String(n).padStart(3, '0')}`));
const included = source.filter((scenario) =>
  ['cli_deep_tasks', 'tool_cli_workflow', 'agent_workflow', 'agent_loop'].includes(scenario.dimension)
  || safety.has(scenario.id));
const pilotIds = new Set(['CLI-CN-001', 'CLI-CN-031', 'CLI-CN-032', 'CLI-CN-033', 'CLI-CN-034', 'CLI-CN-035', 'CLI-CN-036',
  'TC-CN-054', 'HA-CN-045', 'SA-CN-022']);
const originalDocker = new Set(['cli-original-docker-v1', 'cli-advanced-docker-v1', 'recovery-world-docker-v1'].flatMap(name =>
  JSON.parse(fs.readFileSync(`data/pilots/${name}.json`, 'utf8')))
  .map((scenario) => scenario.requirements?.migrationSourceId));
const entries = included.map((scenario) => {
  const mode = scenario.dimension === 'cli_deep_tasks'
    ? (scenario.requirements?.explore ? 'interactive_shell' : 'script')
    : 'tool_world';
  const status = originalDocker.has(scenario.id) ? 'docker_development_fixture'
    : pilotIds.has(scenario.id) ? 'development_pilot'
    : scenario.dimension === 'agent_loop' ? 'docker_development_pilot'
    : scenario.status === 'retired' ? 'retired_saturated' : 'pending_fixture';
  return {
    sourceId: scenario.id,
    sourceStatus: scenario.status,
    dimension: scenario.dimension,
    sourceScenarioVersion: scenario.scenarioVersion,
    sourceGraderVersion: scenario.graderVersion,
    targetMode: mode,
    status,
    requirementFields: Object.keys(scenario.requirements ?? {}),
    migrationGate: mode === 'script'
      ? 'independent input fixtures + expected stdout/files + protected files + positive and negative reference run'
      : 'initial state + allowed tools + result/forbidden-state assertions + positive and negative reference run',
  };
});
if (entries.length !== 194) throw new Error(`Expected 194 migration entries, found ${entries.length}`);
fs.mkdirSync('data/pilots', { recursive: true });
fs.writeFileSync('data/pilots/five-dimension-migration-inventory.json', `${JSON.stringify(entries, null, 2)}\n`);
const counts = Object.groupBy(entries, (entry) => entry.status);
console.log(`Migration inventory: ${entries.length} tasks; ${Object.entries(counts).map(([key, value]) => `${key}=${value.length}`).join(', ')}`);
