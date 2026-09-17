import {createHash} from 'node:crypto';

export const ULTRA_MATH_RUBRIC_VERSION='ultra-math-rubric-2026-09-17-v2';
export type UltraOutcome='completed'|'timeout'|'truncated'|'environment_error';
export type UltraAxis='conclusion'|'proof';
export type UltraFinding='classification_incomplete'|'core_iff_wrong'|'general_formula_wrong'|'class_formula_wrong'|'infinite_lift_wrong'|'internal_contradiction';
export interface UltraCriterion {id:string;axis:UltraAxis;points:number;description:string;blockedBy?:UltraFinding[]}
export interface UltraPartRubric {id:string;groupId:'UMX-01'|'UMX-02';number:number;points:number;hardSeconds:number;criteria:UltraCriterion[]}
export interface UltraAnswer {id:string;outcome:UltraOutcome;output:string}
export interface UltraCriterionReview {id:string;awarded:number;evidence:string}
export interface UltraPartReview {id:string;findings:UltraFinding[];criteria:UltraCriterionReview[];reviewer:string;independent:boolean}

const c=(id:string,axis:UltraAxis,points:number,description:string,blockedBy?:UltraFinding[]):UltraCriterion=>({id,axis,points,description,...(blockedBy?{blockedBy}:{})});
export const ULTRA_MATH_RUBRICS:readonly UltraPartRubric[]=[
 {id:'UMX-01-P1',groupId:'UMX-01',number:1,points:10,hardSeconds:360,criteria:[c('fixed_space_count','conclusion',4,'满足 (i) 的有序三元组个数（=4096）'),c('subspace_count','conclusion',3,'V 中二维子空间的个数（=35）'),c('factorization_proof','proof',3,'用 im A_i ⊆ S ⊆ ker A_i 把 A_i 因子化为 V/S → S 的线性映射（即一个 2×2 矩阵），并说明该对应是双射')]},
 {id:'UMX-01-P2',groupId:'UMX-01',number:2,points:20,hardSeconds:360,criteria:[c('span_total','conclusion',7,'满足 (i) 且 S(T)=S 的三元组个数（=3906）'),c('span_complement','proof',7,'刻画反例：三个像不张满 S ⟺ 三个像全部落在 S 的同一条非零直线上'),c('span_inclusion_exclusion','proof',6,'对 S 的三条非零直线做容斥（每条 4³、两两交 1、三交 1），得反例 3·4³−3+1=190',['classification_incomplete'])]},
 {id:'UMX-01-P3',groupId:'UMX-01',number:3,points:30,hardSeconds:1200,criteria:[c('span_kernel_total','conclusion',8,'满足 (i) 且 S(T)=K(T)=S 的三元组个数（=3780）'),c('kernel_complement','proof',6,'刻画反例：⋂ker ≠ 0 ⟺ 三个核共含同一条非零直线，容斥同样给出 190'),c('joint_failure','proof',8,'两条条件同时不成立的部分为 64，故 4096 − (190+190−64) = 3780',['classification_incomplete']),c('duality_note','proof',8,'说明像条件与核条件在 F₂² 上的对偶关系（像张满 S ↔ 核交为零）')]},
 {id:'UMX-01-P4',groupId:'UMX-01',number:4,points:40,hardSeconds:1200,criteria:[c('distinct_line_total','conclusion',10,'三像恰为 S 的三条互不相同非零直线的三元组个数（=162）'),c('distinct_line_count_proof','proof',6,'按「先分配三条直线 3!，再各选一个满射到该直线的秩 1 矩阵（各 3 个）」得 6·3³=162'),c('distinct_line_kernel_total','conclusion',8,'再要求 K(T)=S 的个数（=144）'),c('kernel_functional_proof','proof',8,'把秩 1 矩阵写成线性泛函形式：⋂ker=0 ⟺ 三个泛函不全相同；反例恰为 6·3=18，故 162−18=144',['classification_incomplete']),c('exact_rank_impossible','conclusion',2,'加强为「对所有非零 λ 都有 rank(λ₁A₁+λ₂A₂+λ₃A₃)=1」时不存在这样的三元组（计数 0）'),c('isotropic_argument','proof',6,'给出理由：det 在 F₂³ 上恒为 0 ⇒ 张成的子空间全各向同性，而 M₂(F₂) 上行列式型的最大全各向同性子空间维数为 2，不存在 3 维全各向同性子空间')]},
 {id:'UMX-02-P1',groupId:'UMX-02',number:1,points:10,hardSeconds:360,criteria:[c('mod4_total','conclusion',3,'模四精确解数'),c('determinant_iff_and_count','proof',7,'等价判据及独立约束计数')]},
 {id:'UMX-02-P2',groupId:'UMX-02',number:2,points:20,hardSeconds:360,criteria:[c('class_count','conclusion',3,'等价类数'),c('class_size','conclusion',3,'各类大小'),c('invariant','proof',6,'不变量定义与不变性'),c('invariant_complete','proof',8,'不变量完备性')]},
 {id:'UMX-02-P3',groupId:'UMX-02',number:3,points:30,hardSeconds:1200,criteria:[c('lift_iff','conclusion',10,'可提升的充要条件',['core_iff_wrong']),c('liftable_count','conclusion',4,'可提升解数'),c('lifts_per_base','conclusion',4,'每个可提升解的提升数'),c('lift_fiber_proof','proof',4,'每解提升数的独立线性计数'),c('iff_proof','proof',8,'提升条件的必要性与充分性',['core_iff_wrong'])]},
 {id:'UMX-02-P4',groupId:'UMX-02',number:4,points:40,hardSeconds:1200,criteria:[c('general_total','conclusion',4,'一般解数公式'),c('general_classes','conclusion',4,'一般类数与类大小'),c('one_step_condition','conclusion',3,'一步提升条件'),c('one_step_count','conclusion',1,'每个可提升解的下一层提升数'),c('infinite_condition','conclusion',4,'无限逐层提升条件'),c('general_count_proof','proof',10,'一般计数证明',['general_formula_wrong']),c('general_class_proof','proof',6,'一般等价分类证明',['class_formula_wrong']),c('lifting_proof','proof',8,'一步提升与无限延续证明',['core_iff_wrong','infinite_lift_wrong'])]},
] as const;

for(const part of ULTRA_MATH_RUBRICS){
 if(part.criteria.reduce((n,x)=>n+x.points,0)!==part.points)throw new Error(`Rubric points mismatch: ${part.id}`);
 if(new Set(part.criteria.map(x=>x.id)).size!==part.criteria.length)throw new Error(`Duplicate criterion: ${part.id}`);
}

export const ULTRA_MATH_RELEASE={
 version:ULTRA_MATH_RUBRIC_VERSION,questionVersion:'ultra-math-2026-09-17-v3',groups:2,parts:8,points:200,
 timingSeconds:[360,360,1200,1200],carryOnlyPriorSubmittedAnswers:true,freshContextPerGroup:true,
 futurePartsHidden:true,answerFeedback:false,tools:false,automaticRetries:0,partialCredit:true,
 scoring:'criterion_points_with_semantic_caps',proofReview:'human_required_for_official_score',
 status:'approved_explicit_progressive_exam',defaultAtomicBank:false,
 rationale:'The default atomic scenario runner cannot preserve same-group submissions or per-part deadlines. '
   +'v3 (2026-09-17) rewrote UMX-01: the v2 version asked for a full conjugacy classification with centralizer '
   +'orders and an F_4 rank-distribution over V = F_2^6, which is unreachable without tools (measured: 7 of 8 '
   +'parts forced to 0 by HARD_TIME_LIMIT 1200s or token exhaustion). v3 reduces the state space to V = F_2^4 '
   +'with a 2-dimensional common subspace, keeping the same structural insight (the operators factor through '
   +'V/S -> S) while bounding each part to 10^2..10^3 elementary operations.',
} as const;

const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const validNumber=(n:number,max:number)=>Number.isFinite(n)&&n>=0&&n<=max;
export function scoreUltraMathRubric(answers:UltraAnswer[],reviews:UltraPartReview[]){
 const answerIds=new Set(answers.map(x=>x.id));
 if(answers.length!==answerIds.size||answers.some(a=>!ULTRA_MATH_RUBRICS.some(r=>r.id===a.id)||!['completed','timeout','truncated','environment_error'].includes(a.outcome)||typeof a.output!=='string'))throw new Error('Invalid answers');
 if(reviews.length!==new Set(reviews.map(x=>x.id)).size||reviews.some(r=>!answerIds.has(r.id)||!r.reviewer.trim()))throw new Error('Invalid reviews');
 const rows=ULTRA_MATH_RUBRICS.map(part=>{
  const answer=answers.find(a=>a.id===part.id),review=reviews.find(r=>r.id===part.id),empty=!answer?.output.trim();
  const environmentError=answer?.outcome==='environment_error';
  if(review){
   if(review.criteria.length!==new Set(review.criteria.map(x=>x.id)).size)throw new Error(`Duplicate reviewed criterion: ${part.id}`);
   if(review.findings.some(f=>!['classification_incomplete','core_iff_wrong','general_formula_wrong','class_formula_wrong','infinite_lift_wrong','internal_contradiction'].includes(f)))throw new Error(`Unknown finding: ${part.id}`);
  }
  const criteria=part.criteria.map(def=>{
   const item=review?.criteria.find(x=>x.id===def.id),blocked=def.blockedBy?.some(x=>review?.findings.includes(x))??false;
   if(item&&(!validNumber(item.awarded,def.points)||(!item.evidence.trim()&&item.awarded>0)))throw new Error(`Invalid criterion review: ${part.id}/${def.id}`);
   const awarded=empty||environmentError||blocked?0:item?.awarded??0;
   return {...def,awarded,blocked,evidence:item?.evidence??(empty?'No submitted answer':environmentError?'Environment error':'Not reviewed')};
  });
  const conclusion=criteria.filter(x=>x.axis==='conclusion').reduce((n,x)=>n+x.awarded,0),proof=criteria.filter(x=>x.axis==='proof').reduce((n,x)=>n+x.awarded,0);
  return {id:part.id,groupId:part.groupId,number:part.number,points:part.points,hardSeconds:part.hardSeconds,state:answer?.outcome??'not_attempted',submitted:!empty,
   outputSha256:answer?hash(answer.output):null,conclusion,proof,earned:conclusion+proof,criteria,independentReview:review?.independent??false};
 });
 const groups=(['UMX-01','UMX-02'] as const).map(groupId=>{const selected=rows.filter(x=>x.groupId===groupId),earned=selected.reduce((n,x)=>n+x.earned,0);return{groupId,earned,points:100,score:earned,submitted:selected.filter(x=>x.submitted).length,parts:4};});
 const earned=groups.reduce((n,x)=>n+x.earned,0),environmentErrors=rows.filter(x=>x.state==='environment_error').length;
 return {version:ULTRA_MATH_RUBRIC_VERSION,rows,groups,earned,points:200,score:environmentErrors?null:earned/2,
  conclusion:{earned:rows.reduce((n,x)=>n+x.conclusion,0),points:rows.flatMap(x=>x.criteria).filter(x=>x.axis==='conclusion').reduce((n,x)=>n+x.points,0)},
  proof:{earned:rows.reduce((n,x)=>n+x.proof,0),points:rows.flatMap(x=>x.criteria).filter(x=>x.axis==='proof').reduce((n,x)=>n+x.points,0)},
  completion:{submitted:rows.filter(x=>x.submitted).length,parts:8,completed:rows.filter(x=>x.state==='completed').length},
  comparable:environmentErrors===0,official:reviews.length===8&&reviews.every(x=>x.independent)&&environmentErrors===0,
  reviewStatus:reviews.length===8&&reviews.every(x=>x.independent)?'independently_reviewed':'provisional_review'};
}

export function compareUltraMathScores(left:ReturnType<typeof scoreUltraMathRubric>,right:ReturnType<typeof scoreUltraMathRubric>){
 if(left.score===null||right.score===null)throw new Error('Comparable completed screens required');
 const partDeltas=left.rows.map((row,i)=>({id:row.id,left:row.earned,right:right.rows[i].earned,delta:row.earned-right.rows[i].earned}));
 return {version:ULTRA_MATH_RUBRIC_VERSION,leftScore:left.score,rightScore:right.score,scoreGap:left.score-right.score,
  separatingParts:partDeltas.filter(x=>x.delta!==0).length,crossover:left.groups.some((g,i)=>g.earned>right.groups[i].earned)&&left.groups.some((g,i)=>g.earned<right.groups[i].earned),partDeltas,
  interpretation:'Descriptive result under documented provider configurations; it does not establish equal-compute or stable population ranking.'};
}
