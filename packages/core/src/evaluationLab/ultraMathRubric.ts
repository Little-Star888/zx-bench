import {createHash} from 'node:crypto';

export const ULTRA_MATH_RUBRIC_VERSION='ultra-math-rubric-2026-09-14-v1';
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
 {id:'UMX-01-P1',groupId:'UMX-01',number:1,points:10,hardSeconds:360,criteria:[c('fixed_space_count','conclusion',3,'固定空间的三元组数'),c('grassmann_count','conclusion',3,'三维子空间数'),c('bijection_and_no_duplication','proof',4,'商空间双射及无重复计数')]},
 {id:'UMX-01-P2',groupId:'UMX-01',number:2,points:20,hardSeconds:360,criteria:[c('fixed_space_total','conclusion',6,'固定公共空间的精确总数'),c('classification_cover','proof',8,'分类覆盖且互不重叠',['classification_incomplete']),c('class_counts','proof',6,'各类计数及汇总',['classification_incomplete'])]},
 {id:'UMX-01-P3',groupId:'UMX-01',number:3,points:30,hardSeconds:1200,criteria:[c('global_total','conclusion',4,'全部三元组数'),c('conjugacy_classes','conclusion',4,'同时共轭类数'),c('centralizer_distribution','conclusion',4,'中心化子阶分布'),c('centralizer_proof','proof',8,'中心化子结构证明'),c('ordered_complete_classification','proof',10,'分类完备并正确处理有序性',['classification_incomplete'])]},
 {id:'UMX-01-P4',groupId:'UMX-01',number:4,points:40,hardSeconds:1200,criteria:[c('profile_table','conclusion',12,'全部秩分布、类数与原始三元组数'),c('stable_total','conclusion',4,'扩域后处处秩二的总数'),c('extension_analysis','proof',8,'对已列类型的扩域秩分析'),c('no_omissions','proof',8,'证明扩域分析没有遗漏',['classification_incomplete']),c('classification_consistency','proof',8,'与完整分类计数一致',['classification_incomplete'])]},
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
 version:ULTRA_MATH_RUBRIC_VERSION,questionVersion:'ultra-math-2026-09-14-v2',groups:2,parts:8,points:200,
 timingSeconds:[360,360,1200,1200],carryOnlyPriorSubmittedAnswers:true,freshContextPerGroup:true,
 futurePartsHidden:true,answerFeedback:false,tools:false,automaticRetries:0,partialCredit:true,
 scoring:'criterion_points_with_semantic_caps',proofReview:'human_required_for_official_score',
 status:'approved_explicit_progressive_exam',defaultAtomicBank:false,
 rationale:'The default atomic scenario runner cannot preserve same-group submissions or per-part deadlines.',
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
