import {expect,it,vi,beforeEach} from 'vitest';
import {isolatedJavaOptions,validIsolatedJavaJsonContract,JAVA_JSON_IMAGE} from './isolatedJavaJson.js';
import {ISOLATED_JAVA_JSON_PILOTS} from '../evaluationLab/isolatedJavaJsonGold.js';
import {codeRepairEvaluator} from '../evaluators/codeRepair.js';
import {runInContainer} from './containerRunner.js';
vi.mock('./containerRunner.js',async original=>({...await original<object>(),runInContainer:vi.fn()}));
beforeEach(()=>vi.mocked(runInContainer).mockReset());
const fixture=ISOLATED_JAVA_JSON_PILOTS['CP-L3-SEM-JV-001'];
it('validates ten fixed adapters and rejects executable or malformed call shapes',()=>{
  expect(Object.keys(ISOLATED_JAVA_JSON_PILOTS)).toHaveLength(10);
  for(const f of Object.values(ISOLATED_JAVA_JSON_PILOTS))expect(validIsolatedJavaJsonContract(f.contract)).toBe(true);
  for(const bad of [
    {...fixture.contract,adapter:'eval'},
    {...fixture.contract,cases:[]},
    {...fixture.contract,cases:[{...fixture.contract.cases[0],calls:[[1,1,'code()']]}]},
    {...fixture.contract,cases:[{...fixture.contract.cases[0],expected:[true]}]},
    {...fixture.contract,cases:[fixture.contract.cases[0],fixture.contract.cases[0]]},
  ])expect(validIsolatedJavaJsonContract(bad)).toBe(false);
});
it('uses pinned hardened Java and mounts only candidate plus data-only driver',()=>{
  const c=fixture.contract.cases[0],o=isolatedJavaOptions(fixture.correct,fixture.contract,c.calls);
  expect(o.image).toBe(JAVA_JSON_IMAGE);expect(o.files?.map(f=>f.path)).toEqual(['Candidate.java','Driver.java']);
  expect(o).toMatchObject({localImageOnly:true,readOnlyRoot:true,readOnly:true,networkDisabled:true,runAsNonRoot:true,memoryMb:384,pidsLimit:64,maxOutputBytes:65536});
  const serialized=JSON.stringify(o);
  for(const hidden of [c.id,'expected','absoluteTolerance','score":100'])expect(serialized).not.toContain(hidden);
  expect(serialized).toContain('Integer.valueOf(100)');
});
it('does not permit a Java contract on another language before execution',async()=>{
  const scenario={id:'x',language:'javascript',functionName:fixture.contract.entrypoint,requirements:{isolatedJavaJson:fixture.contract},hiddenTests:fixture.contract.cases.map(c=>({id:c.id}))};
  const r=await codeRepairEvaluator.evaluate(scenario as any,'```js\nfunction sameCredit(){return true}\n```',{} as any);
  expect(r.environmentError).toBe(true);expect(r.axisCoverage).toBe(0);expect(runInContainer).not.toHaveBeenCalled();
});
