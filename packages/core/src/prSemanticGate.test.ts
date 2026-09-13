import { expect, it, vi } from 'vitest';
import { orchestrateEvaluation } from './orchestrator.js';
import { registerEvaluator } from './evaluators/index.js';
import { llmJudgeEvaluator } from './evaluators/llmJudge.js';
import { callModelWithRetry, callModel } from './model/caller.js';
import { runTieredJudge } from './judge/index.js';
import { PR_ADVERSARIAL_CONTROLS, PR_CONTROL_SCENARIO } from './evaluationLab/deepAdversarial.js';
vi.mock('./model/caller.js', () => ({callModelWithRetry:vi.fn(),callModel:vi.fn()}));
vi.mock('./judge/index.js', async original => ({...await original<object>(),runTieredJudge:vi.fn()}));
it('the retained free-text diagnostic stays fail-closed and cannot be rescued by an unvalidated Judge', async () => {
  registerEvaluator(llmJudgeEvaluator);
  const scenario = { ...PR_CONTROL_SCENARIO, scenarioVersion: 'control', scenarioHash: 'control-hash', promptTemplate: 'review the supplied diff' } as any;
  vi.mocked(callModelWithRetry).mockResolvedValue({content:PR_ADVERSARIAL_CONTROLS[2].output,
    finishReason:'stop',usage:{inputTokens:10,outputTokens:30},latencyMs:1} as any);
  const r = await orchestrateEvaluation({scenario,modelConfig:{id:'mock',name:'mock',provider:'local',baseUrl:'http://unused',defaultParams:{}},
    modelParams:{maxTokens:8192},evalConfig:{judgeEnabled:true},judgeOptions:{localModel:{id:'judge'}}} as any);
  expect(r.environmentError).toBe(true);
  expect(r.totalScore).toBe(0);
  expect(r.axisCoverage).toBe(0);
  expect(r.humanReviewRequired).toBe(true);
  expect(r.humanReviewNotes).toContain('PR语义核验器尚未通过对抗验收');
  expect(r.evidence.some(e=>e.startsWith('SEMANTIC_VERIFIER_UNAVAILABLE:'))).toBe(true);
  expect(callModel).not.toHaveBeenCalled();
  expect(runTieredJudge).not.toHaveBeenCalled();
});
