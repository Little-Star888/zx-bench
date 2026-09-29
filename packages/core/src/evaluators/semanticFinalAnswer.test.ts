import { describe, expect, it, vi } from 'vitest';
import type { ModelResponse, OutputMetadata, Scenario, ScenarioResult, SemanticFinalReview } from '@zxbench/types';
import { evaluateWorldTrace } from './worldTrace.js';
import { toolCallTraceEvaluator } from './toolCallTrace.js';
import { registerEvaluator } from './index.js';
import { orchestrateEvaluation } from '../orchestrator.js';
import { callModel } from '../model/caller.js';
import { applySemanticFinalReview, parseSemanticVerdict, semanticFinalReviewCandidate,
  SEMANTIC_FINAL_REVIEW_VERSION } from './semanticFinalAnswer.js';

const scenario = { id: 'world-semantic', promptTemplate: '查询订单状态',
  requirements: { executionWorld: { initialState: {}, tools: [], maxTurns: 1, scoreMode: 'strict',
    requiredCalls: [{ tool: 'lookup' }], finalMessageMustContain: ['订单状态'] } },
} as unknown as Scenario;
const response = { content: 'SAY 订单已经发货', finishReason: 'stop',
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, latencyMs: 1,
  executionWorld: { initialState: {}, finalState: {}, events: [{ tool: 'lookup', args: {}, ok: true }],
    turns: [], finalMessage: '订单已经发货', turnErrors: [], terminationReason: 'completed' },
} as unknown as ModelResponse;
const metadata = { incomplete: false, truncated: false } as OutputMetadata;
vi.mock('../model/caller.js', async importOriginal => ({
  ...await importOriginal<typeof import('../model/caller.js')>(), callModel: vi.fn(),
}));
registerEvaluator(toolCallTraceEvaluator);
const verdict = (equivalent: boolean | null): SemanticFinalReview => ({
  version: SEMANTIC_FINAL_REVIEW_VERSION, judgeModelId: 'judge-1', judgeModel: 'deepseek-v4.1-flash',
  status: equivalent === true ? 'equivalent' : equivalent === false ? 'not_equivalent' : 'inconclusive',
  checks: [{ id: 'world_final_0', equivalent, quote: equivalent ? '订单已经发货' : '' }],
});

describe('semantic final-answer review', () => {
  it('gives full credit only when all execution facts pass and the Judge confirms meaning', () => {
    const scored = evaluateWorldTrace(scenario, response);
    expect(scored.totalScore).toBe(0);
    expect(semanticFinalReviewCandidate(scenario, response, metadata, scored)?.checks)
      .toEqual([{ id: 'world_final_0', requiredMeaning: '订单状态' }]);
    applySemanticFinalReview(scored, verdict(true));
    expect(scored.totalScore).toBe(100);
    expect(scored.deterministicScore).toBe(0);
    expect(scored.criterionResults?.find(c => c.id === 'world_final_0'))
      .toMatchObject({ status: 'pass', source: 'llm' });
    expect(scored.criterionResults?.every(c => c.status === 'pass')).toBe(true);
    expect(scored.axisEvidence?.task_result).toBe('llm');
  });

  it('retains zero on non-equivalence or an inconclusive decision', () => {
    for (const equivalent of [false, null]) {
      const scored = evaluateWorldTrace(scenario, response);
      applySemanticFinalReview(scored, verdict(equivalent));
      expect(scored.totalScore).toBe(0);
      expect(scored.criterionResults?.find(c => c.id === 'world_final_0')?.status).toBe('fail');
      expect(scored.humanReviewRequired).toBe(equivalent === null ? true : undefined);
    }
  });

  it('never reviews failed calls, forbidden actions, protocol errors or truncated output', () => {
    const base = structuredClone(response) as ModelResponse;
    const trace = base.executionWorld as { events: unknown[]; turnErrors: string[]; terminationReason: string };
    trace.events = [];
    expect(semanticFinalReviewCandidate(scenario, base, metadata, evaluateWorldTrace(scenario, base))).toBeNull();
    trace.events = [{ tool: 'lookup', args: {}, ok: true }, { tool: 'delete', args: {}, ok: true }];
    const forbidden = { ...scenario, requirements: { executionWorld: {
      ...(scenario.requirements as { executionWorld: object }).executionWorld, forbiddenCalls: ['delete'] } } } as Scenario;
    expect(semanticFinalReviewCandidate(forbidden, base, metadata, evaluateWorldTrace(forbidden, base))).toBeNull();
    trace.events = [{ tool: 'lookup', args: {}, ok: true }];
    trace.turnErrors = ['WORLD_TOTAL_TIMEOUT'];
    expect(semanticFinalReviewCandidate(scenario, base, metadata, evaluateWorldTrace(scenario, base))).toBeNull();
    trace.turnErrors = [];
    trace.terminationReason = 'truncated';
    expect(semanticFinalReviewCandidate(scenario, base, metadata, evaluateWorldTrace(scenario, base))).toBeNull();
    expect(semanticFinalReviewCandidate(scenario, response, { ...metadata, truncated: true },
      evaluateWorldTrace(scenario, response))).toBeNull();
  });

  it('requires an exact check set and a quote found in the final answer', () => {
    const candidate = semanticFinalReviewCandidate(scenario, response, metadata,
      evaluateWorldTrace(scenario, response))!;
    expect(parseSemanticVerdict('{"checks":[{"id":"world_final_0","equivalent":true,"quote":"订单已经发货"}]}',
      candidate)[0].equivalent).toBe(true);
    expect(() => parseSemanticVerdict('{"checks":[{"id":"world_final_0","equivalent":true,"quote":"已退款"}]}',
      candidate)).toThrow();
    expect(() => parseSemanticVerdict('{"checks":[{"id":"world_final_1","equivalent":true,"quote":"订单已经发货"}]}',
      candidate)).toThrow();
    expect(() => parseSemanticVerdict('{"checks":[]}', candidate)).toThrow();
  });

  it('does not accept an inconsistent success verdict from another caller', () => {
    const scored: Partial<ScenarioResult> = evaluateWorldTrace(scenario, response);
    applySemanticFinalReview(scored, { ...verdict(true), checks: [{ id: 'world_final_0', equivalent: false, quote: '' }] });
    expect(scored.totalScore).toBe(0);
  });

  it('isolates a failed Judge call as grading infrastructure failure', () => {
    const scored = evaluateWorldTrace(scenario, response);
    applySemanticFinalReview(scored, { ...verdict(null), status: 'error', checks: [], error: 'timeout' });
    expect(scored.totalScore).toBe(0);
    expect(scored.environmentError).toBe(true);
    expect(scored.humanReviewRequired).toBe(true);
  });

  it('persists the semantic decision in the scored result and audit', async () => {
    vi.mocked(callModel).mockResolvedValueOnce({ content: JSON.stringify({ checks: [
      { id: 'world_final_0', equivalent: true, quote: '订单已经发货' }],
    }), finishReason: 'stop', usage: { inputTokens: 30, outputTokens: 12, totalTokens: 42 },
    latencyMs: 1 });
    const fullScenario = { ...scenario, dimension: 'tool_cli_workflow', grader: 'tool_call_trace',
      graderVersion: 'tool_trace_v4', scenarioVersion: '1', scenarioHash: 'fixture',
      scoring: { type: 'tool_call_trace' } } as Scenario;
    const judged = await orchestrateEvaluation({ scenario: fullScenario,
      modelConfig: { id: 'tested', name: 'tested', provider: 'openai', baseUrl: 'http://localhost', defaultParams: {} },
      modelParams: { maxTokens: 100 },
      evalConfig: { judgeEnabled: false, semanticFinalReviewEnabled: true,
        safetyCheckEnabled: false, structuredOutputEnabled: false } as never,
      judgeOptions: { localModel: { id: 'judge-1', name: 'another-judge', provider: 'openai',
        baseUrl: 'http://localhost', defaultParams: {}, modelType: 'judge' }, escalationThreshold: .85 },
      savedCandidate: { response, metadata },
    });
    expect(judged.totalScore).toBe(100);
    expect(judged.semanticFinalReview?.status).toBe('equivalent');
    expect(judged.outputMetadata.evaluationAudit?.semanticFinalReview?.judgeModelId).toBe('judge-1');
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it('does not silently change the scoring rule of a historical run without the frozen flag', async () => {
    vi.mocked(callModel).mockClear();
    const old = await orchestrateEvaluation({ scenario: { ...scenario,
      dimension: 'tool_cli_workflow', grader: 'tool_call_trace', graderVersion: 'tool_trace_v4',
      scenarioVersion: '1', scenarioHash: 'fixture', scoring: { type: 'tool_call_trace' } } as Scenario,
      modelConfig: { id: 'tested', name: 'tested', provider: 'openai', baseUrl: 'http://localhost', defaultParams: {} },
      modelParams: { maxTokens: 100 },
      evalConfig: { judgeEnabled: false, safetyCheckEnabled: false, structuredOutputEnabled: false } as never,
      judgeOptions: { localModel: { id: 'judge-1', name: 'any-judge', provider: 'openai',
        baseUrl: 'http://localhost', defaultParams: {}, modelType: 'judge' }, escalationThreshold: .85 },
      savedCandidate: { response, metadata },
    });
    expect(old.totalScore).toBe(0);
    expect(old.semanticFinalReview).toBeUndefined();
    expect(callModel).not.toHaveBeenCalled();
  });
});
