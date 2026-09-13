import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {ISOLATED_JAVA_JSON_PILOTS} from '../evaluationLab/isolatedJavaJsonGold.js';
import {runIsolatedJavaJsonSuite} from './isolatedJavaJson.js';
import {codeRepairEvaluator} from '../evaluators/codeRepair.js';
import {runJavaTestsInContainer} from './javaRunner.js';
const integration=process.env.ZXBENCH_CONTAINER_TESTS==='1'?describe:describe.skip;
const bank=JSON.parse(readFileSync('data/scenarios/benchmark.json','utf8'));
integration('isolated Java adapter and host-owned predicates',()=>{
  for(const [id,fixture] of Object.entries(ISOLATED_JAVA_JSON_PILOTS))it(`${id}: gold, original and mutant preserve legacy verdicts`,async()=>{
    const scenario=bank.find((s:any)=>s.id===id);
    for(const [kind,code] of [['gold',fixture.correct],['original',scenario.sourceCode],['mutant',fixture.mutant]]){
      const r=await codeRepairEvaluator.evaluate(scenario,'```java\n'+code+'\n```',{} as any);
      expect(r.environmentError,r.evidence?.join('\n')).toBe(false);
      if(kind==='gold')expect(r.axisScores?.test_pass).toBe(100);else expect(r.axisScores?.test_pass).toBeLessThan(100);
      const legacy=await runJavaTestsInContainer(code,scenario.hiddenTests,scenario.requirements.fixture);
      expect(legacy.timedOut,`${id}/${kind} legacy timeout`).toBe(false);
      expect(legacy.tests).toHaveLength(scenario.hiddenTests.length);
      for(const [i,test] of scenario.hiddenTests.entries())expect(r.runtimeEvaluation?.details.find((d:any)=>d.testId===test.id)?.passed,
        `${id}/${kind}/${test.id} changed semantics`).toBe(legacy.tests[i].passed);
    }
    const dev=await runIsolatedJavaJsonSuite(fixture.correct,{...fixture.contract,cases:fixture.developmentCases});
    expect(dev.infrastructureError).toBeUndefined();expect(dev.passed).toBe(dev.total);
  },180_000);
  it('rejects readable-driver output, forged score, write attempts and nonfinite values',async()=>{
    const expected=randomUUID(),base={protocol:'isolated-java-json-v1' as const,entrypoint:'normalizeDate',adapter:'strict-date' as const,
      cases:[{id:'host-only',calls:[['2021-01-01']],expected:[{equals:expected}]}]};
    for(const code of [
      'static String normalizeDate(String s){try{return java.nio.file.Files.readString(java.nio.file.Path.of("/workspace/Driver.java"));}catch(Exception e){return s;}}',
      'static String normalizeDate(String s){System.out.print("{\\\"passed\\\":true,\\\"score\\\":100}");System.exit(0);return s;}',
      'static String normalizeDate(String s){try{java.nio.file.Files.writeString(java.nio.file.Path.of("/workspace/Driver.java"),"x");}catch(Exception e){}return s;}',
    ]){const r=await runIsolatedJavaJsonSuite(code,base);expect(r.infrastructureError).toBeUndefined();expect(r.passed).toBe(0);}
    const nonfinite=await runIsolatedJavaJsonSuite('static double average(int[]x){return Double.NaN;}',{protocol:'isolated-java-json-v1',entrypoint:'average',adapter:'int-array-average',cases:[{id:'finite',calls:[[[1]]],expected:[{equals:0}]}]});
    expect(nonfinite.infrastructureError).toBeUndefined();expect(nonfinite.passed).toBe(0);
  },60_000);
});
