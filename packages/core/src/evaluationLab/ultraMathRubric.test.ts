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
 it('archives the v2 screening profiles and keeps the comparison machinery sound',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../../../data/scenarios/ultra-math-exam-manifest.json',import.meta.url),'utf8'));
  // 33.0 / 38.5 是 2026-09-14 用 **v2 题面**（V=F₂⁶ 版 UMX-01）测出的历史值。
  // v3 重写了 UMX-01，因此这些数字必须显式标注为「不代表当前题面」，只作留档。
  expect(manifest.screening).toMatchObject({archivedVersion:'ultra-math-2026-09-14-v2',invalidForCurrentQuestions:true});
  expect(manifest.screening['qwen3.8-27b-nvfp4'].score).toBe(33);
  expect(manifest.screening['deepseek-v4-flash'].score).toBe(38.5);

  // 比较机制本身：用**新** criteria id 造两份评分，验证 separatingParts / crossover / scoreGap
  const partial:UltraPartReview[]=[fullReviews()[0],fullReviews()[1],
    review('UMX-01-P3',{span_kernel_total:8,kernel_complement:6,joint_failure:8},['classification_incomplete']),
    fullReviews()[3],...fullReviews().slice(4)];
  const lower=scoreUltraMathRubric(answers(),partial),full=scoreUltraMathRubric(answers(),fullReviews());
  expect(lower.rows.find(x=>x.id==='UMX-01-P3')!.earned).toBe(14);   // 8+6，joint_failure 被 classification_incomplete 归零
  expect(lower.score).toBe(92);                                      // (10+20+14+40+100)/2
  const cmp=compareUltraMathScores(lower,full);
  expect(cmp).toMatchObject({separatingParts:1,crossover:false,scoreGap:-8,leftScore:92,rightScore:100});
 });
});
