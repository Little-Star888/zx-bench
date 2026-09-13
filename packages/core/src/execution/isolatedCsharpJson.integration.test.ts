import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {ISOLATED_CSHARP_JSON_PILOTS} from '../evaluationLab/isolatedCsharpJsonGold.js';
import {runIsolatedCsharpJsonSuite} from './isolatedCsharpJson.js';
import {codeRepairEvaluator} from '../evaluators/codeRepair.js';
import {runCsharpTestsInContainer} from './csharpRunner.js';
const integration=process.env.ZXBENCH_CONTAINER_TESTS==='1'?describe:describe.skip;
const bank=JSON.parse(readFileSync('data/scenarios/benchmark.json','utf8'));
integration('isolated C# adapter and host-owned predicates',()=>{
  for(const [id,fixture] of Object.entries(ISOLATED_CSHARP_JSON_PILOTS))it(`${id}: gold, original and mutant preserve legacy verdicts`,async()=>{
    const scenario=bank.find((s:any)=>s.id===id);
    const variants=[['gold',fixture.correct],['original',scenario.sourceCode],['mutant',fixture.mutant]].filter(([,code],i,a)=>a.findIndex(([,seen])=>seen===code)===i);
    for(const [kind,code] of variants){
      const migrated={...scenario,graderVersion:'4.14.0',requirements:{...scenario.requirements,isolatedCsharpJson:fixture.contract}};
      const r=await codeRepairEvaluator.evaluate(migrated,'```csharp\n'+code+'\n```',{} as any);
      expect(r.environmentError,r.evidence?.join('\n')).toBe(false);
      if(kind==='gold')expect(r.axisScores?.test_pass).toBe(100);else expect(r.axisScores?.test_pass).toBeLessThan(100);
      const legacy=await runCsharpTestsInContainer(code,scenario.hiddenTests,scenario.requirements.fixture);
      expect(legacy.timedOut,`${id}/${kind} legacy timeout`).toBe(false);
      expect(legacy.tests).toHaveLength(scenario.hiddenTests.length);
      for(const [i,test] of scenario.hiddenTests.entries())expect(r.runtimeEvaluation?.details.find((d:any)=>d.testId===test.id)?.passed,
        `${id}/${kind}/${test.id} changed semantics`).toBe(legacy.tests[i].passed);
    }
    const dev=await runIsolatedCsharpJsonSuite(fixture.correct,{...fixture.contract,cases:fixture.developmentCases});
    expect(dev.infrastructureError).toBeUndefined();expect(dev.passed).toBe(dev.total);
  },240_000);
  it('rejects readable-driver output, forged score, write attempts and nonfinite values',async()=>{
    const expected=randomUUID(),base={protocol:'isolated-csharp-json-v1' as const,entrypoint:'RoundMoney',adapter:'decimal-round' as const,
      cases:[{id:'host-only',calls:[['1.25']],expected:[{equals:expected}]}]};
    for(const code of [
      'public static decimal RoundMoney(decimal x){try{return decimal.Parse(System.IO.File.ReadAllText("/workspace/Driver.cs"));}catch{return x;}}',
      'public static decimal RoundMoney(decimal x){Console.Write("{\\"passed\\":true,\\"score\\":100}");Environment.Exit(0);return x;}',
      'public static decimal RoundMoney(decimal x){try{System.IO.File.WriteAllText("/workspace/Driver.cs","x");}catch{}return x;}',
    ]){const r=await runIsolatedCsharpJsonSuite(code,base);expect(r.infrastructureError).toBeUndefined();expect(r.passed).toBe(0);}
    const nonfinite=await runIsolatedCsharpJsonSuite('public static double Sum(double[] x){return double.NaN;}',{protocol:'isolated-csharp-json-v1',entrypoint:'Sum',adapter:'decimal-sum',cases:[{id:'finite',calls:[[['1'],1]],expected:[{equals:'0'}]}]});
    expect(nonfinite.infrastructureError).toBeUndefined();expect(nonfinite.passed).toBe(0);
  },120_000);
});
