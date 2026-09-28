import fs from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const source = JSON.parse(fs.readFileSync('data/scenarios/benchmark.json', 'utf8'));
const ids = ['CLI-CN-033', 'CLI-CN-034', 'CLI-CN-035', 'CLI-CN-036'];
const pilots = ids.map((id) => {
  const base = source.find((scenario) => scenario.id === id);
  if (!base || !Array.isArray(base.requirements?.workspace?.files)) throw new Error(`Missing fixture: ${id}`);
  const pilot = structuredClone(base);
  pilot.id = `${id}-SHELL-PILOT`;
  pilot.grader = 'cli_command';
  pilot.graderVersion = 'cli_command_v5';
  pilot.scenarioVersion = '1.0.0';
  pilot.responseMode = 'live_execution';
  pilot.tier = 'private_dev';
  pilot.reviewStatus = 'unreviewed';
  pilot.scoring = { type: 'cli_command', mode: 'executed_investigation' };
  const files = base.requirements.workspace.files.map((file) => file.path.endsWith('/start.sh')
    ? { ...file, content: file.content.replace(/^#!\/bin\/bash\b/, '#!/bin/sh'), executable: true }
    : file);
  pilot.requirements = { executionShell: { files,
    answer: base.requirements.answer, maxTurns: id === 'CLI-CN-036' ? 7 : 5, minCommands: 2,
    ...(id === 'CLI-CN-033' || id === 'CLI-CN-035' ? { maxCommandsPerTurn: 8 } : {}) }, developmentShadow: true };
  pilot.scenarioHash = hashScenarioShort(pilot);
  return pilot;
});
fs.mkdirSync('data/pilots', { recursive: true });
fs.writeFileSync('data/pilots/shell-investigation-v1.json', `${JSON.stringify(pilots, null, 2)}\n`);
console.log(`Wrote ${pilots.length} interactive Docker shell pilots`);
