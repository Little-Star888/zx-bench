import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ISOLATED_GO_JSON_PILOTS } from '../evaluationLab/isolatedGoJsonGold.js';
import { runIsolatedGoJsonSuite } from './isolatedGoJson.js';
import { codeRepairEvaluator } from '../evaluators/codeRepair.js';
import { runGoTestsInContainer } from './goRunner.js';

const integration = process.env.ZXBENCH_CONTAINER_TESTS === '1' ? describe : describe.skip;
const bank = JSON.parse(readFileSync('data/scenarios/benchmark.json', 'utf8'));

integration('isolated Go adapters', () => {
  for (const [id, fixture] of Object.entries(ISOLATED_GO_JSON_PILOTS)) {
    it(`${id}: gold, original and mutant preserve legacy verdicts`, async () => {
      const scenario = bank.find((x: any) => x.id === id);
      const variants = [['gold', fixture.correct], ['original', scenario.sourceCode], ['mutant', fixture.mutant]]
        .filter(([, code], i, all) => all.findIndex(([, seen]) => seen === code) === i);
      for (const [kind, code] of variants) {
        const migrated = {...scenario, graderVersion:'4.14.0', requirements:{...scenario.requirements, isolatedGoJson:fixture.contract}};
        const result = await codeRepairEvaluator.evaluate(migrated, '```go\n' + code + '\n```', {} as any);
        expect(result.environmentError, result.evidence?.join('\n')).toBe(false);
        if (kind === 'gold') expect(result.axisScores?.test_pass).toBe(100);
        else expect(result.axisScores?.test_pass).toBeLessThan(100);
        const legacy = await runGoTestsInContainer(code, scenario.hiddenTests, scenario.requirements.fixture);
        expect(legacy.timedOut).toBe(false);
        for (const [i, test] of scenario.hiddenTests.entries()) {
          expect(result.runtimeEvaluation?.details.find((d:any) => d.testId === test.id)?.passed, `${id}/${kind}/${test.id}`)
            .toBe(legacy.tests[i].passed);
        }
      }
      const dev = await runIsolatedGoJsonSuite(fixture.correct, {...fixture.contract, cases:fixture.developmentCases});
      expect(dev.infrastructureError).toBeUndefined();
      expect(dev.passed).toBe(dev.total);
    }, 420_000);
  }

  it('rejects extra output, score forgery and workspace-write attempts with a wrong result', async () => {
    const contract = {protocol:'isolated-go-json-v1' as const, entrypoint:'Atoi', adapter:'atoi-result' as const,
      cases:[{id:'host', calls:[['7','value']], expected:[{equals:7}]}]};
    for (const code of ['func Atoi(s string)(int,error){fmt.Print(`{"score":100}`);return 7,nil}',
      'func Atoi(s string)(int,error){os.WriteFile("/workspace/main.go",[]byte("x"),0644);return 8,nil}']) {
      const result = await runIsolatedGoJsonSuite(code, contract);
      expect(result.infrastructureError).toBeUndefined();
      expect(result.passed).toBe(0);
    }
  }, 60_000);
});
