import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import type {Scenario} from '@zxbench/types';
import {structuredContractV2Evaluator as evaluator,structuredContractV3Evaluator,prepareExtendedContract} from './structuredContractV2.js';
const pack=JSON.parse(readFileSync('data/pilots/structured-contract-v2/development.json','utf8')) as Scenario[];
const grade=(id:string,out:string)=>evaluator.evaluate(pack.find(s=>s.id===id)!,out,{} as never);
describe('extended structured contracts',()=>{
 it('preserves CSV quoted newlines and rejects extra headers',async()=>{
  const r=await grade('SOC2-F-D-csv','code,name,note\r\n001,"甲,""乙""","line1\nline2"\r\n010,ON,\r\n');
  expect(r.totalScore).toBe(100);
  expect((await grade('SOC2-F-D-csv','code,name,note,extra\n001,a,b,c')).totalScore).toBe(0);
 });
 it('interprets YAML ON as a string and rejects duplicate mapping keys',async()=>{
  expect((await grade('SOC2-F-D-yaml','- code: "001"\n  name: \'甲,"乙"\'\n  note: "line1\\nline2"\n- code: "010"\n  name: ON\n  note: ""')).totalScore).toBe(100);
  expect((await grade('SOC2-F-D-yaml','x: 1\nx: 2')).structuredContractMetrics?.syntaxValid).toBe(false);
 });
 it('decodes XML entities and keeps null distinct from empty string',async()=>{
  const gold=JSON.parse(readFileSync('data/pilots/structured-contract-v2/development-gold.json','utf8')).find((g:{id:string})=>g.id==='SOC2-F-D-xml');
  expect((await grade('SOC2-F-D-xml',gold.raw.replace('甲,','&#x7532;,'))).totalScore).toBe(100);
  expect((await grade('SOC2-F-D-xml',gold.raw.replace('<note null="true"/>','<note/>'))).totalScore).toBe(0);
 });
 it('checks generated schemas behaviorally, accepts reordered equivalent schemas, rejects remote refs',async()=>{
  const gold=JSON.parse(readFileSync('data/pilots/structured-contract-v2/development-gold.json','utf8')).find((g:{id:string})=>g.id==='SOC2-G-D-1');
  const s=JSON.parse(gold.raw);s.description='An allowed extra annotation';
  expect((await grade('SOC2-G-D-1',JSON.stringify({allOf:[s]}))).totalScore).toBe(100);
  expect((await grade('SOC2-G-D-1','true')).totalScore).toBe(0);
  const invalid=await grade('SOC2-G-D-1','{"$ref":"https://example.invalid/no-network"}');
  expect(invalid.totalScore).toBe(0);expect(invalid.environmentError).not.toBe(true);
 });
 it('uses the corrected backend for generated if/else annotations, and excludes unsupported frozen schemas',async()=>{
  const schema={$schema:'https://json-schema.org/draft/2020-12/schema',if:{properties:{foo:{const:'then'}},required:['foo']},
    else:{properties:{baz:{type:'string'}},required:['baz']},unevaluatedProperties:false};
  const original=pack.find(s=>s.id==='SOC2-G-D-1')!;
  const req={...original.requirements as object,generatedSchema:{cases:[{data:{foo:'then'},valid:true},{data:{foo:'else',baz:'baz'},valid:false}]}};
  const s={...original,graderVersion:'structured_contract_v3',requirements:req} as unknown as Scenario;
  expect((await structuredContractV3Evaluator.evaluate(s,JSON.stringify(schema),{} as never)).totalScore).toBe(100);
  expect(()=>prepareExtendedContract({...req,schema} as never)).toThrow('AJV profile');
 });
});
