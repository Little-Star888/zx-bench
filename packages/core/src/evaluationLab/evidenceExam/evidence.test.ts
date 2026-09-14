import { describe,it,expect } from 'vitest';
import { snapshot,gradeSnapshot } from './temporal.js';
import { rules,updatedRules,referenceRule,gradeRule } from './rules.js';
import { buildEvidenceExam,referenceOutput,scoreExam } from './index.js';

describe('targeted evidence semantics',()=>{
  it('distinguishes valid time, knowledge time, tombstones and same-time conflicts',()=>{
    expect(snapshot({entity:'A',field:'status',valid:5,known:5})).toEqual({status:'determined',value:'closed',sources:['E05']});
    expect(snapshot({entity:'A',field:'status',valid:5,known:9})).toEqual({status:'determined',value:'open',sources:['E01','E05','R01']});
    expect(snapshot({entity:'A',field:'status',valid:7,known:12})).toEqual({status:'determined',value:'open',sources:['E01','E05','E09','R01','R04']});
    expect(snapshot({entity:'B',field:'owner',valid:7,known:12})).toEqual({status:'conflict',value:['Sun','Zhou'],sources:['E10','E11']});
    expect(snapshot({entity:'C',field:'owner',valid:7,known:12})).toEqual({status:'missing',value:null,sources:[]});
    expect(gradeSnapshot({entity:'B',field:'status',valid:7,known:12},{status:'determined',value:'open',sources:['E03']},10).earned).toBe(7);
  });
  it('requires sufficient minimal support, accepting correct classification only for partial credit',()=>{
    expect(gradeRule(rules,6,referenceRule(rules,6),10).earned).toBe(10);
    expect(gradeRule(rules,6,{status:'determined',value:true,sources:['S06']},10).earned).toBe(3);
    expect(gradeRule(rules,6,{status:'determined',value:true,sources:rules.map(r=>r.id)},10).earned).toBe(3);
    expect(gradeRule(updatedRules,7,{status:'determined',value:false,sources:['S02','S07']},10).earned).toBe(0);
  });
  it('checks both unknown witnesses against all rules, including retained facts',()=>{
    const a=referenceRule(updatedRules,13);
    expect(gradeRule(updatedRules,13,a,10).earned).toBe(10);
    if(!('witnessTrue' in a))throw Error();
    const bad=structuredClone(a);bad.witnessTrue![0]=false;
    expect(gradeRule(updatedRules,13,bad,10).earned).toBe(3);
    expect(gradeRule(rules,1,{status:'insufficient',value:null,witnessTrue:Array(14).fill(true),witnessFalse:Array(14).fill(false)},10).earned).toBe(0);
  });
  it('assembles eight questions and retains committed points when a final part is cut off',()=>{
    const p=buildEvidenceExam();expect(p.parts).toHaveLength(8);
    const input={contractHash:p.contractHash,runId:'synthetic',modelId:'synthetic',modelFamily:'synthetic',answers:p.parts.map(part=>({id:part.id,questionHash:part.question.questionHash,outcome:'completed' as const,output:referenceOutput(part)}))};
    expect(scoreExam(p,input).dimensions.map(x=>x.score)).toEqual([100,100]);
    const cut={...input,answers:input.answers.map((a,i)=>i===3?{...a,outcome:'truncated' as const,output:a.output.split('\n')[0]+'\n{"item":"A.owner","answer":'}:a)};
    expect(scoreExam(p,cut).dimensions.map(x=>x.score)).toEqual([68,100]);
  });
});
