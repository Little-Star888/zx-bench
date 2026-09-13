import {describe,expect,it} from 'vitest';
import {lightweightDiscriminationGate,observedDiscrimination,type ObservedDimensionModel} from './observedDiscrimination.js';
const model=(id:string,family:string,bits:(boolean|null)[],executionClass:'local_unsloth'|'provider_api'='provider_api'):ObservedDimensionModel=>({modelId:id,modelFamily:family,executionClass,
  rows:bits.map((pass,i)=>({id:`q${i}`,family:i<2?'a':'b',pass,state:pass===null?'missing':'completed'}))});
describe('observed same-question discrimination',()=>{
  it('reports separation across three declared families without calling it calibrated',()=>{
    const r=observedDiscrimination('d',[model('qwen','Qwen',[true,false,true],'local_unsloth'),model('deep','DeepSeek',[true,true,true]),model('glm','GLM',[false,false,true])]);
    expect(r.screeningSignal).toBe('observed_same_question_separation');expect(r.scoreSpread).toBeCloseTo(66.6667,3);
    expect(r.separatingItems).toBe(2);expect(r.strictSameRuntimeComparison).toBe(false);expect(r.difficultyCalibrated).toBe(false);
  });
  it('flags a possible dimension ceiling only with enough families',()=>{
    expect(observedDiscrimination('d',[model('a','A',[true,true]),model('b','B',[true,true]),model('c','C',[true,true])]).screeningSignal).toBe('possible_dimension_ceiling');
    expect(observedDiscrimination('d',[model('a','A',[true,true]),model('b','B',[true,true])]).screeningSignal).toBe('insufficient_declared_model_families');
  });
  it('reports pairwise discordance rather than averaging retries',()=>{
    const r=observedDiscrimination('d',[model('a','A',[true,false]),model('b','B',[false,false]),model('c','C',[true,true])]);
    expect(r.pairs.map(p=>p.discordantItems)).toEqual([1,1,2]);expect(r.combinedScore).toBeNull();
  });
  it('supports the lightweight 12-question one-item score step while still requiring item separation',()=>{
    const r=lightweightDiscriminationGate('d',[model('a','A',[true,true,true,true,true,true,true,true,true,true,true,false]),model('b','B',[true,true,true,true,true,true,true,true,true,true,true,true]),model('c','C',[false,true,true,true,true,true,true,true,true,true,true,true])],{minScoreSpread:8,minSeparatingRate:0.25});
    expect(r.scoreSpread).toBeCloseTo(8.3333,3);expect(r.readyForMaintainerFreeze).toBe(false);
    expect(r.separatingRate).toBeCloseTo(2/12);
  });
  it('caps foundation questions against the final selected set',()=>{
    const r=lightweightDiscriminationGate('d',[model('a','A',[true,true,true,true,true]),model('b','B',[false,false,false,false,true]),model('c','C',[true,false,true,false,true])]);
    expect(r.disposition.officialCandidates).toHaveLength(4);expect(r.disposition.foundationCandidates).toHaveLength(1);
    expect(r.disposition.foundationCandidates.length/(r.disposition.officialCandidates.length+r.disposition.foundationCandidates.length)).toBe(0.2);
  });
  it('nominates separating questions and caps easy foundation questions',()=>{
    const r=lightweightDiscriminationGate('d',[
      model('small','Small',[true,false,false,true,true]),
      model('mid','Mid',[true,true,false,true,false]),
      model('large','Large',[true,true,true,true,true]),
    ]);
    expect(r.readyForMaintainerFreeze).toBe(true);
    expect(r.disposition.officialCandidates).toEqual(['q1','q2','q4']);
    expect(r.disposition.foundationCandidates).toEqual([]);
    expect(r.disposition.foundationOverflow).toEqual(['q0','q3']);
    expect(r.disposition.reviseOrExperimental).toEqual([]);
    expect(r.productionEligible).toBe(false);
  });
  it('does not pass an all-easy pack or two-family comparison',()=>{
    const easy=lightweightDiscriminationGate('d',[model('a','A',[true,true]),model('b','B',[true,true]),model('c','C',[true,true])]);
    expect(easy.readyForMaintainerFreeze).toBe(false);
    expect(easy.disposition.foundationCandidates).toEqual([]);
    const two=lightweightDiscriminationGate('d',[model('a','A',[true,false]),model('b','B',[false,true])]);
    expect(two.readyForMaintainerFreeze).toBe(false);
  });
  it.each([
    ()=>observedDiscrimination('',[model('a','A',[true]),model('b','B',[false])]),
    ()=>observedDiscrimination('d',[model('a','A',[true]),model('a','B',[false])]),
    ()=>observedDiscrimination('d',[model('a','A',[true]),model('b','B',[true,false])]),
    ()=>observedDiscrimination('d',[model('a','A',[null]),model('b','B',[true])]),
    ()=>observedDiscrimination('d',[model('a','A',[true]),{...model('b','B',[false]),rows:[{id:'q0',family:'changed',pass:false,state:'completed'}]}]),
  ])('rejects incomparable inputs',fn=>expect(fn).toThrow());
});
