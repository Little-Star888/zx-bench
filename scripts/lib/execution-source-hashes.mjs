import fs from 'node:fs';
import path from 'node:path';
import { digest } from './execution-task-pack.mjs';
function sources(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sources(file) : entry.name.endsWith('.js') && !entry.name.includes('.test.')
      ? [[file.replaceAll('\\', '/'), fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n')]] : [];
  });
}
export function sourceHashes() {
  const root = 'packages/core/dist';
  return {
    runtime: digest([...sources(`${root}/execution`), ...sources(`${root}/agentLoop`), ...sources(`${root}/model`),
      [`${root}/orchestrator.js`, fs.readFileSync(`${root}/orchestrator.js`, 'utf8').replaceAll('\r\n', '\n')]]),
    verifier: digest(sources(`${root}/evaluators`)),
  };
}
