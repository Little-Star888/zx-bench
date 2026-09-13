import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const runner = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const isolation = process.argv.includes('--isolation');
const observation = process.argv.includes('--observation');
const prWitness = process.argv.includes('--pr-witness');
if ([isolation, observation, prWitness].filter(Boolean).length > 1) throw Error('Choose one container suite');
const targets=prWitness ? ['packages/core/src/evaluationLab/prWitnessSql.test.ts'] : observation ? ['packages/core/src/execution/quickJsObservation.integration.test.ts','packages/core/src/execution/quickJsObservationV2.test.ts'] : isolation ? ['packages/core/src/execution/isolatedJson.integration.test.ts','packages/core/src/execution/isolatedJavaJson.integration.test.ts','packages/core/src/execution/isolatedCsharpJson.integration.test.ts','packages/core/src/execution/isolatedGoJson.integration.test.ts','packages/core/src/execution/isolatedJavascriptJson.integration.test.ts','packages/core/src/execution/isolatedPhpJsonV2.integration.test.ts','packages/core/src/execution/isolatedTypescriptMigration.integration.test.ts','packages/core/src/execution/isolatedFixtureExit.integration.test.ts'] : ['packages/core/src/execution/crossLanguage.integration.test.ts'];
const r = spawnSync(process.execPath, [runner, 'run', ...targets, '--reporter=verbose', ...process.argv.slice(2).filter(a=>!['--isolation','--observation','--pr-witness'].includes(a))], {
  cwd: root, stdio: 'inherit', env: { ...process.env, ZXBENCH_CONTAINER_TESTS: prWitness ? '0' : '1', ZXBENCH_PR_WITNESS_CONTAINERS: prWitness ? '1' : '0' },
});
if (r.error) console.error(r.error.message);
process.exitCode = r.status ?? 1;
