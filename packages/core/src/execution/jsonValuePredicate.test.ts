import { it, expect } from 'vitest';
import { compareJsonObservation, validIsolatedJsonContract, isolatedCandidateOptions } from './isolatedJson.js';
import { ISOLATED_JSON_NUMERIC_PILOTS } from '../evaluationLab/isolatedJsonNumericGold.js';
const near=(inclusive=false)=>[{all:[{path:[],approx:{value:0,absoluteTolerance:1e-9,inclusive}}]}];
it.each([
  ['[0]',true],['[5e-10]',true],['[-5e-10]',true],['[1e-9]',false],['[-1e-9]',false],
  ['[2e-9]',false],['["0"]',false],['[false]',false],['[null]',false],['[NaN]',false],['[1e400]',false],
  ['[{"passed":true}]',false],['[0,0]',false],['[]',false],
])('strict absolute tolerance, no coercion: %s', (output,passed)=>{
  expect(compareJsonObservation(output as string,near(),'isolated-json-v3')).toBe(passed);
});
it('inclusive boundary is explicit, and negative zero retains the JSON contract restriction',()=>{
  expect(compareJsonObservation('[1e-9]',near(true),'isolated-json-v3')).toBe(true);
  expect(compareJsonObservation('[-1e-9]',near(true),'isolated-json-v3')).toBe(true);
  expect(compareJsonObservation('[-0]',near(),'isolated-json-v3')).toBe(false);
});
it('partial paths preserve both original assertions without inventing an output-length assertion',()=>{
  const expected=ISOLATED_JSON_NUMERIC_PILOTS['CP-L2-TD-PY-002'].contract.cases[0].expected;
  for(const output of ['[[0.6,0.8]]','[[0.6,0.8,999]]'])expect(compareJsonObservation(output,expected,'isolated-json-v3')).toBe(true);
  for(const output of ['[[0.6]]','[[0.6,0]]','[["0.6",0.8]]','[null]'])expect(compareJsonObservation(output,expected,'isolated-json-v3')).toBe(false);
  expect(compareJsonObservation('[{}]',[{all:[{path:['toString'],equals:null}]}],'isolated-json-v3')).toBe(false);
});
it('v1/v2 treat predicate-shaped objects as literal values, never as instructions',()=>{
  for(const version of ['isolated-json-v1','isolated-json-v2'] as const){
    expect(compareJsonObservation('[0]',near(),version)).toBe(false);
    expect(compareJsonObservation(JSON.stringify(near()),near(),version)).toBe(true);
  }
  expect(compareJsonObservation('[0]',[0],'isolated-json-v3')).toBe(false);
  expect(compareJsonObservation('[false]',[{equals:0}],'isolated-json-v3')).toBe(false);
});
it('rejects empty, ambiguous and invalid predicates before inference',()=>{
  const c=ISOLATED_JSON_NUMERIC_PILOTS['CP-L2-PY-004'].contract;
  for(const predicate of [null,{}, {all:[]}, {equals:0,all:[]}, {all:[{path:[],approx:{value:0,absoluteTolerance:0,inclusive:false}}]},
    {all:[{path:[],approx:{value:0,absoluteTolerance:NaN,inclusive:false}}]},
    {all:[{path:[],approx:{value:0,absoluteTolerance:1e-9,inclusive:'false'}}]},
    {all:[{path:[-1],equals:0}]}, {all:[{path:[],equals:0,approx:{}}]}]){
    expect(validIsolatedJsonContract({...c,cases:[{id:'x',calls:[[]],expected:[predicate]}]})).toBe(false);
  }
  expect(validIsolatedJsonContract(c)).toBe(true);
  expect(validIsolatedJsonContract({...c,cases:[{...c.cases[0],keywordArgs:[{}]}]})).toBe(false);
});
it('v3 uses the existing value transport, never mounting host comparison rules or oracle',()=>{
  const c=ISOLATED_JSON_NUMERIC_PILOTS['CP-L2-PY-004'].contract;
  const o=isolatedCandidateOptions('def hours_between(a,b): return 0','python',c.entrypoint,c.cases[0].calls,3000,c.protocol);
  expect(JSON.parse(o.files!.find(f=>f.path==='input.json')!.content)).toEqual({entrypoint:c.entrypoint,calls:c.cases[0].calls});
  for(const hidden of ['absoluteTolerance','hidden-1','expected','equals'])expect(JSON.stringify(o)).not.toContain(hidden);
});
