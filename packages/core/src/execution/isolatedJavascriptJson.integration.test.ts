import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {runIsolatedJavascriptJsonSuite} from './isolatedJavascriptJson.js';
import {ISOLATED_JAVASCRIPT_JSON_PILOTS} from '../evaluationLab/isolatedJavascriptJsonGold.js';

const integration=process.env.ZXBENCH_CONTAINER_TESTS==='1'?describe:describe.skip;
const bank=JSON.parse(readFileSync('data/scenarios/benchmark.json','utf8'));

integration('JavaScript bounded host-verdict adapters',()=>{
  it('passes gold and development controls while rejecting each original and mutant',async()=>{
    const entries=Object.entries(ISOLATED_JAVASCRIPT_JSON_PILOTS);let next=0;
    const worker=async()=>{while(next<entries.length){const [id,p]=entries[next++];
      const candidates=[['gold',p.correct],['original',bank.find((x:any)=>x.id===id).sourceCode],['mutant',p.mutant]] as const;
      const [results,dev]=await Promise.all([Promise.all(candidates.map(([,code])=>runIsolatedJavascriptJsonSuite(code,p.contract))),runIsolatedJavascriptJsonSuite(p.correct,{...p.contract,cases:p.developmentCases})]);
      for(let i=0;i<candidates.length;i++){
        const kind=candidates[i][0],r=results[i];
        expect(r.infrastructureError,`${id}/${kind}`).toBeUndefined();
        if(kind==='gold')expect(r.passed,`${id}/${kind}`).toBe(r.total);
        else expect(r.passed,`${id}/${kind}`).toBeLessThan(r.total);
      }
      expect(dev.infrastructureError,id).toBeUndefined();expect(dev.passed,id).toBe(dev.total);
    }};
    await Promise.all(Array.from({length:4},worker));
  },240_000);
});
