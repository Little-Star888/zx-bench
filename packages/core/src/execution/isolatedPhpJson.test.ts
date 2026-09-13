import { expect, it, vi, beforeEach } from 'vitest';
import { isolatedCandidateOptions, validIsolatedJsonContract, runIsolatedJsonSuite, PHP_JSON_IMAGE } from './isolatedJson.js';
import { ISOLATED_PHP_JSON_PILOTS } from '../evaluationLab/isolatedPhpJsonGold.js';
import { codeRepairEvaluator } from '../evaluators/codeRepair.js';
import { runInContainer } from './containerRunner.js';
vi.mock('./containerRunner.js',async original=>({...await original<object>(),runInContainer:vi.fn()}));
beforeEach(()=>vi.mocked(runInContainer).mockReset());
const contract=ISOLATED_PHP_JSON_PILOTS['CP-L3-SEM-PHP-001'].contract;
it('accepts only complete fixed PHP transforms and exact JSON values',()=>{
  expect(validIsolatedJsonContract(contract)).toBe(true);
  for(const resultTransforms of [undefined,[],['identity','identity'],['array_values'],[null]])
    expect(validIsolatedJsonContract({...contract,cases:[{...contract.cases[0],resultTransforms}]})).toBe(false);
  expect(validIsolatedJsonContract({...contract,protocol:'isolated-json-v1'})).toBe(false);
});
it('mounts only candidate, fixed driver and current inputs using the pinned hardened PHP image',()=>{
  const c=contract.cases[1];
  const o=isolatedCandidateOptions('<?php function normalizeTags($x){return $x;} ?>','php',contract.entrypoint,c.calls,3000,contract.protocol,undefined,c.resultTransforms);
  expect(o.image).toBe(PHP_JSON_IMAGE);
  expect(o).toMatchObject({localImageOnly:true,readOnlyRoot:true,readOnly:true,networkDisabled:true,runAsNonRoot:true,memoryMb:128,pidsLimit:32});
  expect(o.files?.map(f=>f.path)).toEqual(['candidate.php','driver.php','input.json']);
  expect(o.files?.find(f=>f.path==='candidate.php')?.content).not.toContain('<?php\n<?php');
  expect(JSON.parse(o.files!.find(f=>f.path==='input.json')!.content)).toEqual({entrypoint:'normalizeTags',calls:c.calls,resultTransforms:['arrayValues']});
  for(const secret of ['CP-L3-SEM-PHP-001-hidden-2','expected','A","B'])expect(JSON.stringify(o)).not.toContain(secret);
});
it('rejects protocol/language confusion before any candidate execution',async()=>{
  const base={id:'x',functionName:'normalizeTags',hiddenTests:contract.cases.map(c=>({id:c.id})),requirements:{isolatedJson:contract}};
  for(const language of ['javascript','python','typescript']){
    const r=await codeRepairEvaluator.evaluate({...base,language} as any,'```php\nfunction normalizeTags($x){return $x;}\n```',{} as any);
    expect(r.environmentError).toBe(true);expect(r.axisCoverage).toBe(0);
  }
  expect(runInContainer).not.toHaveBeenCalled();
});
it.each([{timedOut:true},{outputLimitExceeded:true},{infrastructureError:'host failure'}])('matching output cannot override %j',async failure=>{
  const one={...contract,cases:[contract.cases[0]]};
  const ok={success:true,stdout:'[["PHP","8.2","STABLE"]]',stderr:'',exitCode:0,timedOut:false,durationMs:1};
  vi.mocked(runInContainer).mockResolvedValueOnce(ok).mockResolvedValue({...ok,...failure});
  expect((await runIsolatedJsonSuite('', 'php', one)).passed).toBe(0);
});
it('all five PHP fixtures retain unique original IDs and transforms',()=>{
  expect(Object.keys(ISOLATED_PHP_JSON_PILOTS)).toHaveLength(5);
  for(const fixture of Object.values(ISOLATED_PHP_JSON_PILOTS)){
    expect(fixture.contract.protocol).toBe('isolated-php-json-v1');
    expect(new Set(fixture.contract.cases.map(c=>c.id)).size).toBe(fixture.contract.cases.length);
    expect(fixture.contract.cases.every(c=>c.resultTransforms?.length===c.calls.length)).toBe(true);
  }
});
