import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {runIsolatedPhpJsonSuite} from './isolatedPhpJson.js';
import {ISOLATED_PHP_JSON_V2_PILOTS} from '../evaluationLab/isolatedPhpJsonV2Gold.js';
const integration=process.env.ZXBENCH_CONTAINER_TESTS==='1'?describe:describe.skip;
const bank=JSON.parse(readFileSync('data/scenarios/benchmark.json','utf8'));
integration('PHP v2 file and lifecycle observer',()=>{
  it('passes gold and rejects the original and semantic mutant for both migrated tasks',async()=>{
    for(const [id,p] of Object.entries(ISOLATED_PHP_JSON_V2_PILOTS)){
      for(const [kind,code] of [['gold',p.correct],['original',bank.find((x:any)=>x.id===id).sourceCode],['mutant',p.mutant]] as const){
        const r=await runIsolatedPhpJsonSuite(code,p.contract);expect(r.infrastructureError,`${id}/${kind}`).toBeUndefined();
        if(kind==='gold')expect(r.passed,`${id}/${kind}`).toBe(r.total);else expect(r.passed,`${id}/${kind}`).toBeLessThan(r.total);
      }
      const dev=await runIsolatedPhpJsonSuite(p.correct,{...p.contract,cases:p.developmentCases});expect(dev.infrastructureError,id).toBeUndefined();expect(dev.passed,id).toBe(dev.total);
    }
  },180_000);
  it('does not accept candidate-controlled reports or writable observer replacement',async()=>{
    const p=ISOLATED_PHP_JSON_V2_PILOTS['CP-L3-PHP-003'];const c={...p.contract,cases:[p.contract.cases[2]]};
    for(const code of ["function readCsv($p){echo '{\\\"passed\\\":true,\\\"score\\\":100}';exit(0);yield;}","function readCsv($p){file_put_contents('/workspace/driver.php','<?php echo \\\"[0]\\\";');yield;}"]){const r=await runIsolatedPhpJsonSuite(code,c);expect(r.infrastructureError).toBeUndefined();expect(r.passed).toBe(0);}
  },30_000);
});
