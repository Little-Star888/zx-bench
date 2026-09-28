import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const packs = [
  'cli-execution-v1.json', 'tool-world-v1.json', 'retail-docker-v1.json',
  'shell-investigation-v1.json', 'special-shell-v1.json',
];
const imageIds = new Map();
function id(image) {
  if (!imageIds.has(image)) {
    imageIds.set(image, execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', image],
      { encoding: 'utf8' }).trim());
  }
  return imageIds.get(image);
}
for (const pack of packs) {
  const path = `data/pilots/${pack}`;
  const scenarios = JSON.parse(fs.readFileSync(path, 'utf8'));
  for (const scenario of scenarios) {
    const req = scenario.requirements;
    if (req.executionCases) req.executionImageId = id(req.executionImage ?? 'python:3.12-alpine');
    if (req.executionWorld) req.executionWorld.expectedImageId = id(req.executionWorld.image ?? 'python:3.12-alpine');
    if (req.agentLoop?.backend === 'docker') req.agentLoop.expectedImageId = id('node:22-alpine');
    if (req.executionShell) req.executionShell.expectedImageId = id(req.executionShell.image ?? 'python:3.12-alpine');
    scenario.scenarioHash = hashScenarioShort(scenario);
  }
  fs.writeFileSync(path, `${JSON.stringify(scenarios, null, 2)}\n`);
}
console.log(`Pinned ${packs.length} pilot packs to ${imageIds.size} local image IDs`);
