export interface ObservedDimensionModel {
  modelId:string;
  modelFamily:string;
  executionClass:'local_unsloth'|'provider_api';
  rows:{id:string;family:string;pass:boolean|null;state:string}[];
}

/** Descriptive same-question screen. It never turns runtime differences into a causal model ranking. */
export function observedDiscrimination(dimension:string,models:ObservedDimensionModel[]){
  if(!dimension||models.length<2)throw new Error('Dimension and at least two models required');
  if(new Set(models.map(m=>m.modelId)).size!==models.length)throw new Error('One explicit result per model required');
  const ids=models[0].rows.map(r=>r.id),families=new Map(models[0].rows.map(r=>[r.id,r.family]));
  if(!ids.length||new Set(ids).size!==ids.length||models.some(m=>new Set(m.rows.map(r=>r.id)).size!==m.rows.length||
      m.rows.length!==ids.length||m.rows.some(r=>!families.has(r.id)||families.get(r.id)!==r.family)))throw new Error('Complete identical question/family plan required');
  if(models.some(m=>m.rows.some(r=>r.pass===null||r.state!=='completed')))throw new Error('Unmeasured or non-completed result cannot enter screening');
  const normalized=models.map(m=>({...m,rows:ids.map(id=>m.rows.find(r=>r.id===id)!)}));
  const scores=normalized.map(m=>({modelId:m.modelId,modelFamily:m.modelFamily,executionClass:m.executionClass,
    passed:m.rows.filter(r=>r.pass).length,planned:ids.length,score:100*m.rows.filter(r=>r.pass).length/ids.length}));
  const items=ids.map((id,i)=>{const passed=normalized.filter(m=>m.rows[i].pass).length;return {id,family:families.get(id)!,passed,failed:models.length-passed,
    passRate:passed/models.length,allPass:passed===models.length,allFail:passed===0,separatesObservedRuns:passed>0&&passed<models.length};});
  const pairs=normalized.flatMap((a,i)=>normalized.slice(i+1).map(b=>({left:a.modelId,right:b.modelId,
    discordantItems:ids.filter((_,j)=>a.rows[j].pass!==b.rows[j].pass).length,sameExecutionClass:a.executionClass===b.executionClass})));
  const scoreValues=scores.map(s=>s.score),distinctDeclaredModelFamilies=new Set(models.map(m=>m.modelFamily)).size;
  const executionClasses=[...new Set(models.map(m=>m.executionClass))];
  const signal=scoreValues.every(x=>x>=95)?'possible_dimension_ceiling':scoreValues.every(x=>x<=5)?'possible_dimension_floor':
    items.some(i=>i.separatesObservedRuns)?'observed_same_question_separation':'no_observed_separation';
  return {version:'observed-discrimination-2026-09-12-v1',dimension,plannedPerModel:ids.length,models:scores,items,pairs,
    scoreSpread:Math.max(...scoreValues)-Math.min(...scoreValues),separatingItems:items.filter(i=>i.separatesObservedRuns).length,
    allPassItems:items.filter(i=>i.allPass).length,allFailItems:items.filter(i=>i.allFail).length,distinctDeclaredModelFamilies,
    enoughDeclaredFamiliesForInitialScreen:distinctDeclaredModelFamilies>=3,executionClasses,
    strictSameRuntimeComparison:executionClasses.length===1,screeningSignal:distinctDeclaredModelFamilies>=3?signal:'insufficient_declared_model_families',
    independentGold:false,difficultyCalibrated:false,productionEligible:false,combinedScore:null,
    interpretation:'Observed outcomes under documented execution classes; mixed local/API conditions do not isolate model weights or establish a causal ranking.'};
}

export interface LightweightDiscriminationOptions {
  minModelFamilies?:number;
  minScoreSpread?:number;
  minSeparatingRate?:number;
  maxFoundationRate?:number;
}

/** Practical promotion screen for a lightweight benchmark.
 * It nominates questions for maintainer review; it never mutates the bank or
 * promotes a question merely because a strong model answered it correctly. */
export function lightweightDiscriminationGate(
  dimension:string,
  models:ObservedDimensionModel[],
  options:LightweightDiscriminationOptions={},
){
  const report=observedDiscrimination(dimension,models);
  const policy={
    minModelFamilies:options.minModelFamilies??3,
    minScoreSpread:options.minScoreSpread??8,
    minSeparatingRate:options.minSeparatingRate??0.25,
    maxFoundationRate:options.maxFoundationRate??0.20,
  };
  for(const [key,value] of Object.entries(policy))if(!Number.isFinite(value)||value<0)throw new Error(`Invalid ${key}`);
  if(policy.maxFoundationRate>1||policy.minSeparatingRate>1)throw new Error('Rates must be between 0 and 1');
  const separating=report.items.filter(i=>i.separatesObservedRuns);
  const foundation=report.items.filter(i=>i.allPass);
  const revise=report.items.filter(i=>i.allFail);
  // Apply the cap to the final selected set, not the original candidate pool:
  // foundation / (separating + foundation) <= maxFoundationRate.
  const foundationLimit=policy.maxFoundationRate>=1?foundation.length:
    Math.floor(separating.length*policy.maxFoundationRate/(1-policy.maxFoundationRate));
  const enoughFamilies=report.distinctDeclaredModelFamilies>=policy.minModelFamilies;
  const separatingRate=report.items.length?separating.length/report.items.length:0;
  const readyForMaintainerFreeze=enoughFamilies&&report.scoreSpread>=policy.minScoreSpread&&separatingRate>=policy.minSeparatingRate;
  return {...report,policy,separatingRate,
    disposition:{
      officialCandidates:separating.map(i=>i.id),
      foundationCandidates:foundation.slice(0,foundationLimit).map(i=>i.id),
      foundationOverflow:foundation.slice(foundationLimit).map(i=>i.id),
      reviseOrExperimental:revise.map(i=>i.id),
    },
    readyForMaintainerFreeze,
    productionEligible:false,
    promotionRule:'Only officialCandidates plus the bounded foundation subset may be reviewed for freezing; ambiguous, environment-failed and all-fail items are excluded.',
  };
}
