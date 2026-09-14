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
  it('assembles twelve progressive papers per dimension and retains committed points when a part is cut off',()=>{
    const p=buildEvidenceExam();expect(p.parts).toHaveLength(96);
    expect(p.parts.filter(x=>x.dimension==='data_extraction')).toHaveLength(48);
    expect(p.parts.filter(x=>x.dimension==='hallucination_resistance')).toHaveLength(48);
    expect(new Set(p.parts.map(x=>x.groupId))).toHaveLength(24);
    for(const groupId of new Set(p.parts.map(x=>x.groupId))){
      const group=p.parts.filter(x=>x.groupId===groupId);
      expect(group.map(x=>x.points)).toEqual([10,20,30,40]);
      expect(group.map(x=>x.hardSeconds)).toEqual([180,360,1200,1200]);
    }
    const input={contractHash:p.contractHash,runId:'synthetic',modelId:'synthetic',modelFamily:'synthetic',answers:p.parts.map(part=>({id:part.id,questionHash:part.question.questionHash,outcome:'completed' as const,output:referenceOutput(part)}))};
    expect(scoreExam(p,input).dimensions.map(x=>x.score)).toEqual([100,100]);
    const cut={...input,answers:input.answers.map((a,i)=>i===3?{...a,outcome:'truncated' as const,output:a.output.split('\n')[0]+'\n{"item":"A.owner","answer":'}:a)};
    const scored=scoreExam(p,cut);
    expect(scored.rows[3].earned).toBe(8);
    expect(scored.dimensions[0].score).toBeLessThan(100);
    expect(scored.dimensions[1].score).toBe(100);
  });
  it('scores structured leaves without giving free points for extra guesses',()=>{
    const p=buildEvidenceExam(),part=p.parts.find(x=>x.id==='DX3-01-P1')!;
    expect(scoreExam(p,{contractHash:p.contractHash,runId:'x',modelId:'x',modelFamily:'x',answers:[{id:part.id,questionHash:part.question.questionHash,outcome:'completed',output:referenceOutput(part)}]}).rows.find(x=>x.id===part.id)?.earned).toBe(10);
    const noisy='{"item":"result","answer":{"order_id":"O-42","line_id":"wrong","sku":"K7","ordered_qty":4,"unit_price":125,"currency":"CNY","sources":["O01"],"guess":"free"}}';
    const row=scoreExam(p,{contractHash:p.contractHash,runId:'x',modelId:'x',modelFamily:'x',answers:[{id:part.id,questionHash:part.question.questionHash,outcome:'completed',output:noisy}]}).rows.find(x=>x.id===part.id)!;
    expect(row.earned).toBeGreaterThan(0);expect(row.earned).toBeLessThanOrEqual(8);
  });
});
