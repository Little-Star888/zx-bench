import fs from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const source = JSON.parse(fs.readFileSync('data/scenarios/benchmark.json', 'utf8'));
function basePilot(id, shell) {
  const original = source.find((scenario) => scenario.id === id);
  if (!original) throw new Error(`Missing source: ${id}`);
  const pilot = structuredClone(original);
  pilot.id = `${id}-SHELL-PILOT`;
  pilot.grader = 'cli_command';
  pilot.graderVersion = 'cli_command_v5';
  pilot.scenarioVersion = '1.0.0';
  pilot.responseMode = 'live_execution';
  pilot.tier = 'private_dev';
  pilot.reviewStatus = 'unreviewed';
  pilot.scoring = { type: 'cli_command', mode: 'executed_investigation' };
  pilot.requirements = { executionShell: shell, developmentShadow: true };
  pilot.scenarioHash = hashScenarioShort(pilot);
  return pilot;
}

const large = source.find((scenario) => scenario.id === 'CLI-CN-031');
const largeFiles = large.requirements.workspace.files;
const sizeSpec = largeFiles.filter((file) => file.sizeBytes).map((file) => ({ path: file.path,
  size: Math.max(1024, Math.round(file.sizeBytes / 100)) }));
const largeSetup = `import fs from 'node:fs'; import path from 'node:path';\n`
  + `for (const item of ${JSON.stringify(sizeSpec)}) { fs.mkdirSync(path.dirname(item.path), {recursive:true}); fs.writeFileSync(item.path, Buffer.alloc(item.size)); }\n`;
const p31 = basePilot('CLI-CN-031', { image: 'node:22-alpine',
  files: [...largeFiles.filter((file) => typeof file.content === 'string'),
    { path: '__zx_size_setup.mjs', content: largeSetup }],
  setupCommands: ['node __zx_size_setup.mjs && rm __zx_size_setup.mjs'],
  answer: large.requirements.answer, maxTurns: 5, minCommands: 1 });

const history = source.find((scenario) => scenario.id === 'CLI-CN-032');
const repo = history.requirements.workspace.gitRepos[0];
const encodedRepo = Buffer.from(JSON.stringify(repo), 'utf8').toString('base64');
const gitSetup = `import base64, json, os, pathlib, subprocess\n`
  + `repo = json.loads(base64.b64decode('${encodedRepo}'))\n`
  + `pathlib.Path(repo['path']).mkdir(parents=True, exist_ok=True)\n`
  + `def git(args, env=None): subprocess.run(['git', '-C', repo['path'], *args], check=True, env={**os.environ, **(env or {})}, stdout=subprocess.DEVNULL)\n`
  + `git(['init', '-q'])\n`
  + `for commit in repo['commits']:\n`
  + `    for file in commit.get('files', []):\n`
  + `        path = pathlib.Path(repo['path']) / file['path']\n`
  + `        path.parent.mkdir(parents=True, exist_ok=True)\n`
  + `        path.write_text(file.get('content', ''))\n`
  + `    git(['add', '-A'])\n`
  + `    git(['commit', '-q', '-m', commit['message']], {'GIT_AUTHOR_NAME': commit['authorName'], 'GIT_AUTHOR_EMAIL': commit['authorEmail'], 'GIT_COMMITTER_NAME': commit.get('committerName', commit['authorName']), 'GIT_COMMITTER_EMAIL': commit.get('committerEmail', commit['authorEmail']), 'GIT_AUTHOR_DATE': '2025-01-01T00:00:00Z', 'GIT_COMMITTER_DATE': '2025-01-01T00:00:00Z'})\n`;
const p32 = basePilot('CLI-CN-032', { image: 'gcc:13',
  files: [{ path: '__zx_git_setup.py', content: gitSetup }],
  setupCommands: ['python3 __zx_git_setup.py && rm __zx_git_setup.py'],
  answer: history.requirements.answer, maxTurns: 5, minCommands: 1 });

fs.mkdirSync('data/pilots', { recursive: true });
fs.writeFileSync('data/pilots/special-shell-v1.json', `${JSON.stringify([p31, p32], null, 2)}\n`);
console.log('Wrote two special Docker shell pilots');
