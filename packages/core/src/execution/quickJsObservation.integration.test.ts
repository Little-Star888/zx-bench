import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {runQuickJsObservationSuite,validQuickJsObservationContract,quickJsObservationOptions} from './quickJsObservation.js';
import {runInContainer} from './containerRunner.js';
import {QUICKJS_OBSERVATION_PILOTS} from '../evaluationLab/quickJsObservationGold.js';
import {QUICKJS_OBSERVATION_ATTACKS} from '../evaluationLab/quickJsObservationAttacks.js';
import {runTestCaseInContainer} from '../sandbox/index.js';
import {codeRepairEvaluator} from '../evaluators/codeRepair.js';
const integration=process.env.ZXBENCH_CONTAINER_TESTS==='1'?describe:describe.skip;
const bank=JSON.parse(readFileSync('data/scenarios/benchmark.json','utf8'));
integration('experimental QuickJS trusted observer: independent adversarial controls',()=>{
  for(const a of QUICKJS_OBSERVATION_ATTACKS)it(a.id,async()=>{
    const c={protocol:'quickjs-observation-v1' as const,entrypoint:'target',cases:[{id:a.id,calls:a.calls,expected:a.expected}]};
    expect(validQuickJsObservationContract(c)).toBe(true);
    const r=await runQuickJsObservationSuite(a.code,'javascript',c);
    expect(r.infrastructureError,r.details[0]?.stderr).toBeUndefined();
    if(a.expectedObserverStatus)expect(JSON.parse(r.details[0].stdout).status).toBe(a.expectedObserverStatus);
    expect(r.passed,JSON.stringify(r.details)).toBe(a.shouldPass?1:0);
  },30_000);
  it('preserves calls within a case, isolates globals between cases, supports TS erasure',async()=>{
    const cases=[1,2].map(n=>({id:String(n),calls:[[],[]],expected:[1,2].map(value=>({outcome:{kind:'return' as const,value}}))}));
    const r=await runQuickJsObservationSuite('let count: number=0;function target(): number{return ++count}','typescript',
      {protocol:'quickjs-observation-v1',entrypoint:'target',cases});
    expect(r.infrastructureError).toBeUndefined();expect(r.passed,JSON.stringify(r.details)).toBe(2);
  },30_000);
  it('a native operation cannot exceed the host deadline and receive acceptance',async()=>{
    const r=await runInContainer(quickJsObservationOptions('function target(){return "X".repeat(8_000_000).toLowerCase().length}',
      'javascript','target',[[]],10));
    expect(r.infrastructureError).toBeUndefined();
    expect(r.success&&JSON.parse(r.stdout).status==='ok').toBe(false);
  },30_000);
});
integration('experimental question controls: preserve legacy points, separate stronger challenges',()=>{
  for(const [id,f] of Object.entries(QUICKJS_OBSERVATION_PILOTS)){
    const s=bank.find((s:any)=>s.id===id);
    const controls=[{id:'gold',code:f.correct},{id:'original',code:s.sourceCode},...f.mutants];
    for(const control of controls)it(`${id}/${control.id}: old points and development challenges`,async()=>{
      expect(f.contract.cases.map(c=>c.id)).toEqual(s.hiddenTests.map((t:any)=>t.id));
      const official=await codeRepairEvaluator.evaluate(s,'```javascript\n'+control.code+'\n```',{} as any);
      expect(official.environmentError,official.evidence?.join('\n')).toBe(false);
      expect(official.axisEvidence?.test_pass).toBe('verified');
      const legacy={passed:official.runtimeEvaluation!.testsPassed,total:official.runtimeEvaluation!.testsTotal,
        details:official.runtimeEvaluation!.details.map(d=>({...d,id:d.testId}))};
      // Only repository-owned fixed controls enter this diagnostic legacy runner.
      // It is not the trusted observer and cannot award production scores.
      for(const test of s.hiddenTests){
        const old=await runTestCaseInContainer(control.code,null,test);
        expect(old.exitCode,old.stderr).not.toBe(-1);expect(old.timedOut).not.toBe(true);
        expect(legacy.details.find(t=>t.id===test.id)?.passed,`${id}/${control.id}/${test.id}`).toBe(old.passed);
      }
      const dev=await runQuickJsObservationSuite(control.code,f.language,{...f.contract,cases:f.developmentCases});
      expect(dev.infrastructureError).toBeUndefined();
      if(control.id==='gold'){
        expect(legacy.passed,JSON.stringify(legacy.details)).toBe(legacy.total);
        expect(dev.passed,JSON.stringify(dev.details)).toBe(dev.total);
      } else expect(legacy.passed+dev.passed).toBeLessThan(legacy.total+dev.total);
      console.log(JSON.stringify({id,control:control.id,legacy:`${legacy.passed}/${legacy.total}`,development:`${dev.passed}/${dev.total}`}));
    },120_000);
  }
});
