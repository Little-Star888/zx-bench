import {beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {isolatedPhpOptions,runIsolatedPhpJsonSuite,validIsolatedPhpJsonContract,PHP_JSON_V2_IMAGE} from './isolatedPhpJson.js';
import {ISOLATED_PHP_JSON_V2_PILOTS} from '../evaluationLab/isolatedPhpJsonV2Gold.js';
import {codeRepairEvaluator} from '../evaluators/codeRepair.js';
import {runInContainer} from './containerRunner.js';
vi.mock('./containerRunner.js',async original=>({...await original<object>(),runInContainer:vi.fn()}));
beforeEach(()=>vi.mocked(runInContainer).mockReset());
const fixture=ISOLATED_PHP_JSON_V2_PILOTS['CP-L3-PHP-003'];
it('validates only bounded PHP v2 adapter calls and host predicates',()=>{
  expect(validIsolatedPhpJsonContract(fixture.contract)).toBe(true);
  expect(validIsolatedPhpJsonContract({...fixture.contract,protocol:'isolated-php-json-v1'})).toBe(false);
  expect(validIsolatedPhpJsonContract({...fixture.contract,cases:[{...fixture.contract.cases[0],calls:[['stream',60001,60]]}]})).toBe(false);
  expect(validIsolatedPhpJsonContract({...fixture.contract,cases:[{...fixture.contract.cases[0],expected:[{equals:null},{equals:null}]}]})).toBe(false);
});
it('mounts candidate, fixed driver and data fixtures but no oracle',()=>{
  const c=fixture.contract.cases[0],o=isolatedPhpOptions('<?php function readCsv($p){yield [];} ?>',fixture.contract,c.calls);
  expect(o.image).toBe(PHP_JSON_V2_IMAGE);
  expect(o).toMatchObject({localImageOnly:true,readOnlyRoot:true,readOnly:true,networkDisabled:true,runAsNonRoot:true,memoryMb:128,pidsLimit:32});
  expect(o.files?.map(f=>f.path)).toEqual(['candidate.php','driver.php','input.json']);
  expect(JSON.parse(o.files!.find(f=>f.path==='input.json')!.content)).toEqual({calls:c.calls});
  for(const secret of ['CP-L3-PHP-003-hidden-1','expected','1799970000'])expect(JSON.stringify(o)).not.toContain(secret);
});
it('binds both fixtures to v4.8 and preserves original test IDs',()=>{
  const bank=JSON.parse(readFileSync('data/scenarios/benchmark.json','utf8'));
  for(const [id,p] of Object.entries(ISOLATED_PHP_JSON_V2_PILOTS)){const s=bank.find((x:any)=>x.id===id);expect(s.requirements.isolatedPhpJson).toEqual(p.contract);expect(s.hiddenTests.map((x:any)=>x.id)).toEqual(p.contract.cases.map(x=>x.id));expect(s.graderVersion).toBe('4.14.0');expect(s.scenarioVersion).toBe('4.5.0');}
});
it('rejects PHP adapter on another language before execution',async()=>{
  const s={id:'x',language:'javascript',functionName:'readCsv',requirements:{isolatedPhpJson:fixture.contract},hiddenTests:fixture.contract.cases.map(x=>({id:x.id}))};
  const r=await codeRepairEvaluator.evaluate(s as any,'```php\nfunction readCsv($p){yield [];}\n```',{} as any);
  expect(r.environmentError).toBe(true);expect(runInContainer).not.toHaveBeenCalled();
});
it.each([{timedOut:true},{outputLimitExceeded:true},{infrastructureError:'host failure'}])('matching data cannot override %j',async failure=>{
  const one={...fixture.contract,cases:[fixture.contract.cases[2]]};
  const ok={success:true,stdout:'No syntax errors detected in candidate.php',stderr:'',exitCode:0,timedOut:false,durationMs:1};
  vi.mocked(runInContainer).mockResolvedValueOnce(ok).mockResolvedValue({...ok,stdout:'[0]',...failure});
  expect((await runIsolatedPhpJsonSuite(fixture.correct,one)).passed).toBe(0);
});
