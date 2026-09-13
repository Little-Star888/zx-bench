import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { orchestrateEvaluation } from './orchestrator.js';
import { registerEvaluator } from './evaluators/index.js';
import { codeRepairEvaluator } from './evaluators/codeRepair.js';
import { runIsolatedJsonSuite } from './execution/isolatedJson.js';
import { runQuickJsScoringSuite } from './execution/quickJsObservation.js';
import { QUICKJS_OBSERVATION_PILOTS } from './evaluationLab/quickJsObservationGold.js';
import { callModelWithRetry } from './model/caller.js';
import { runTieredJudge } from './judge/index.js';
vi.mock('./model/caller.js',()=>({callModelWithRetry:vi.fn()}));
vi.mock('./judge/index.js',async original=>({...await original<object>(),runTieredJudge:vi.fn()}));
vi.mock('./execution/isolatedJson.js',async original=>({...await original<object>(),runIsolatedJsonSuite:vi.fn()}));
vi.mock('./execution/quickJsObservation.js',async original=>({...await original<object>(),runQuickJsScoringSuite:vi.fn()}));
const bank=JSON.parse(readFileSync('data/scenarios/benchmark.json','utf8'));
const base={modelConfig:{id:'mock',name:'mock',provider:'local',baseUrl:'http://unused',defaultParams:{}},
  modelParams:{maxTokens:8192},evalConfig:{judgeEnabled:true},judgeOptions:{localModel:{id:'judge'}}};
beforeEach(()=>{vi.clearAllMocks();registerEvaluator(codeRepairEvaluator);});
it.each(['3.5.0','3.6.0','3.7.0','3.8.0','3.9.0','4.0.0','4.1.0','4.2.0','4.3.0','4.4.0','4.5.0','4.6.0','4.7.0','4.8.0','4.9.0','4.10.0','4.11.0','4.12.0','4.13.0','4.14.0'])('skips ungradable %s contracts BEFORE spending candidate or Judge tokens',async(graderVersion)=>{
  const template=bank.find((s:any)=>s.id==='CP-L1-JS-002');
  const {isolatedJson:_json,quickJsObservation:_observation,...requirements}=template.requirements;
  const scenario={...template,graderVersion,requirements};
  const r=await orchestrateEvaluation({...base,scenario} as any);
  expect(r.graderVersion).toBe(`code_repair@${graderVersion}`);
  expect(r.environmentError).toBe(true);expect(r.axisCoverage).toBe(0);expect(r.humanReviewNotes).toContain('未调用模型');
  expect(r.outputMetadata.inputTokens).toBe(0);expect(r.runCount).toBe(0);
  expect(callModelWithRetry).not.toHaveBeenCalled();expect(runTieredJudge).not.toHaveBeenCalled();expect(runIsolatedJsonSuite).not.toHaveBeenCalled();expect(runQuickJsScoringSuite).not.toHaveBeenCalled();
});
it.each(['3.5.0','3.6.0','3.7.0','3.8.0','3.9.0','4.0.0','4.1.0','4.2.0','4.3.0','4.4.0','4.5.0','4.6.0','4.7.0','4.8.0','4.9.0','4.10.0','4.11.0','4.12.0','4.13.0','4.14.0'])('keeps failed black-box %s behavior at zero even when Judge is enabled',async(graderVersion)=>{
  // Register an explicit version in this mock-only test; this does not assert
  // historical replay compatibility or register an old scorer in production.
  registerEvaluator({...codeRepairEvaluator,version:graderVersion});
  const scenario={...bank.find((s:any)=>s.id==='CP-L1-JS-001'),graderVersion};
  vi.mocked(runIsolatedJsonSuite).mockResolvedValue({compiled:true,details:[],total:4,passed:0,compileError:undefined,infrastructureError:undefined});
  const response={content:'```js\nfunction sortDesc(a){return [];}\n```',finishReason:'stop',usage:{inputTokens:10,outputTokens:10},latencyMs:1};
  const r=await orchestrateEvaluation({...base,scenario,savedCandidate:{response,metadata:{inputTokens:10,outputTokens:10,finishReason:'stop'}}} as any);
  expect(r.graderVersion).toBe(`code_repair@${graderVersion}`);
  expect(r.axisScores.test_pass).toBe(0);expect(r.environmentError).toBe(false);
  expect(r.finalJudge).toBeUndefined();expect(runTieredJudge).not.toHaveBeenCalled();expect(callModelWithRetry).not.toHaveBeenCalled();
  expect(runQuickJsScoringSuite).not.toHaveBeenCalled();
});
it('does not send failed trusted QuickJS observations to Judge',async()=>{
  registerEvaluator({...codeRepairEvaluator,version:'3.7.0'});
  const template=bank.find((s:any)=>s.id==='CP-L1-JS-002');
  const contract=QUICKJS_OBSERVATION_PILOTS[template.id].contract;
  const scenario={...template,graderVersion:'3.7.0',requirements:{...template.requirements,quickJsObservation:contract}};
  vi.mocked(runQuickJsScoringSuite).mockResolvedValue({compiled:true,compileError:undefined,
    total:contract.cases.length,passed:0,infrastructureError:undefined,
    details:contract.cases.map(c=>({testId:c.id,testType:'hidden' as const,
      stderr:'',exitCode:0,timedOut:false,duration:1,passed:false})),
  });
  const response={content:'```js\nfunction chunk(){return [];}\n```',finishReason:'stop',usage:{inputTokens:10,outputTokens:10},latencyMs:1};
  const r=await orchestrateEvaluation({...base,scenario,savedCandidate:{response,metadata:{inputTokens:10,outputTokens:10,finishReason:'stop'}}} as any);
  expect(r.graderVersion).toBe('code_repair@3.7.0');expect(r.environmentError).toBe(false);expect(r.axisScores.test_pass).toBe(0);
  expect(runQuickJsScoringSuite).toHaveBeenCalledOnce();expect(runIsolatedJsonSuite).not.toHaveBeenCalled();
  expect(runTieredJudge).not.toHaveBeenCalled();expect(callModelWithRetry).not.toHaveBeenCalled();expect(r.finalJudge).toBeUndefined();
});
