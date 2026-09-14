import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {ULTRA_MATH_RELEASE,ULTRA_MATH_RUBRICS,compareUltraMathScores,scoreUltraMathRubric,type UltraAnswer,type UltraPartReview} from './ultraMathRubric.js';

const answers=(submitted=8):UltraAnswer[]=>ULTRA_MATH_RUBRICS.map((r,i)=>({id:r.id,outcome:i<submitted?'completed':'timeout',output:i<submitted?'submitted answer':''}));
const fullReviews=():UltraPartReview[]=>ULTRA_MATH_RUBRICS.map(r=>({id:r.id,findings:[],reviewer:'independent-human',independent:true,criteria:r.criteria.map(c=>({id:c.id,awarded:c.points,evidence:'Verified against frozen solution.'}))}));
const review=(id:string,awards:Record<string,number>,findings:UltraPartReview['findings']=[]):UltraPartReview=>({id,findings,reviewer:'assistant-preliminary',independent:false,criteria:Object.entries(awards).map(([criterion,awarded])=>({id:criterion,awarded,evidence:'Specific reviewed evidence.'}))});

describe('ultra math criterion rubric',()=>{
 it('matches the released progressive-exam manifest',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../../../data/scenarios/ultra-math-exam-manifest.json',import.meta.url),'utf8'));
  expect(manifest).toMatchObject({questionVersion:ULTRA_MATH_RELEASE.questionVersion,status:'approved',defaultAtomicBank:false,scoring:{rubricVersion:ULTRA_MATH_RELEASE.version}});
  expect(manifest.groups.flatMap((g:any)=>g.parts).map((p:any)=>({id:p.id,points:p.points,hardSeconds:p.hardSeconds}))).toEqual(ULTRA_MATH_RUBRICS.map(({id,points,hardSeconds})=>({id,points,hardSeconds})));
 });
 it('has a complete 200-point exam and requires independent review for an official score',()=>{
  const scored=scoreUltraMathRubric(answers(),fullReviews());
  expect(scored).toMatchObject({earned:200,points:200,score:100,official:true,completion:{submitted:8,parts:8,completed:8}});
  expect(scored.groups.map(x=>x.earned)).toEqual([100,100]);
 });
 it('preserves submitted parts, scores empty timeout as zero and applies semantic proof caps',()=>{
  const a=answers(1);a[6]={id:'UMX-02-P3',outcome:'completed',output:'nonempty'};
  const r=[fullReviews()[0],review('UMX-02-P3',{lift_iff:10,lifts_per_base:4,lift_fiber_proof:4,iff_proof:8},['core_iff_wrong'])];
  const scored=scoreUltraMathRubric(a,r),lift=scored.rows.find(x=>x.id==='UMX-02-P3')!;
  expect(scored.groups[0].earned).toBe(10);expect(lift.earned).toBe(8);
  expect(lift.criteria.find(x=>x.id==='iff_proof')).toMatchObject({awarded:0,blocked:true});
  expect(scored.official).toBe(false);
 });
 it('reports the frozen Qwen and DeepSeek preliminary profiles without changing their scores',()=>{
  const qAnswers=answers();for(const i of [1,2,3,7])qAnswers[i].output='';
  const qReviews=[fullReviews()[0],fullReviews()[4],fullReviews()[5],review('UMX-02-P3',{lift_iff:10,liftable_count:0,lifts_per_base:4,lift_fiber_proof:4,iff_proof:8})];
  const q=scoreUltraMathRubric(qAnswers,qReviews);expect(q.score).toBe(33);expect(q.groups.map(x=>x.earned)).toEqual([10,56]);
  const dAnswers=answers();dAnswers[1].output='';
  const dReviews=[fullReviews()[0],review('UMX-01-P3',{centralizer_distribution:2,centralizer_proof:6},['classification_incomplete']),review('UMX-01-P4',{profile_table:8,stable_total:4,extension_analysis:8},['classification_incomplete']),fullReviews()[4],fullReviews()[5],review('UMX-02-P3',{lifts_per_base:4,lift_fiber_proof:4},['core_iff_wrong']),review('UMX-02-P4',{one_step_count:1},['general_formula_wrong','class_formula_wrong','core_iff_wrong','infinite_lift_wrong'])];
  const d=scoreUltraMathRubric(dAnswers,dReviews);expect(d.score).toBe(38.5);expect(d.groups.map(x=>x.earned)).toEqual([38,39]);
  expect(compareUltraMathScores(d,q)).toMatchObject({scoreGap:5.5,separatingParts:4,crossover:true});
 });
});
