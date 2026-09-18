import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JudgeInput, ModelConfig, ModelResponse } from '@zxbench/types';
import { callModel } from '../model/caller.js';
import { runTieredJudge } from './index.js';
import { buildJudgeUserPrompt, getJudgeSystemPrompt } from './prompts.js';
vi.mock('../model/caller.js', () => ({ callModel: vi.fn() }));
const input = { questionId: 'long', dimension: 'program', task: 'repair', candidateAnswer: {}, outputMetadata: {}, rawModelOutput: 'x'.repeat(12000) + 'LAST_FILE_REQUIRED' } as JudgeInput;
const options = { localModel: { name: 'judge', defaultParams: { maxTokens: 16000 } } as ModelConfig, escalationThreshold: 0.85 };
const valid = { verdict: 'correct', bug_detection: 1, root_cause: 1, patch_correctness: 1, patch_completeness: 1, scope_discipline: 1, output_completeness: 1, confidence: 0.95 };
function response(content: string, finishReason = 'stop') { vi.mocked(callModel).mockResolvedValue({ content, finishReason, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } as ModelResponse); }
beforeEach(() => vi.clearAllMocks());
describe('Judge integrity', () => {
  it('requires one compact JSON object without Markdown wrappers', () => {
    expect(getJudgeSystemPrompt('program')).toContain('Return exactly one valid JSON object');
    expect(getJudgeSystemPrompt('program')).toContain('Do not use a Markdown fence');
  });
  it('includes the entire multi-file answer', () => {
    expect(buildJudgeUserPrompt(input)).toContain('LAST_FILE_REQUIRED');
    expect(buildJudgeUserPrompt(input)).not.toContain('[truncated for judge]');
  });
  it('treats CLI command and flag lists as reference implementations', () => {
    const prompt = buildJudgeUserPrompt({ ...input, dimension: 'cli_deep_tasks' });
    expect(prompt).toContain('CLI Semantic-Equivalence Policy');
    expect(prompt).toContain('Accept semantically equivalent pipelines');
    expect(prompt).toContain('awk instead of grep');
  });
  it('uses configured generation budget and accepts a complete judgment', async () => {
    response(JSON.stringify(valid));
    expect((await runTieredJudge(input, options)).finalJudge.patchCorrectness).toBe(1);
    expect(vi.mocked(callModel).mock.calls[0][0].params.maxTokens).toBe(16000);
  });
  it('rejects output cut off by provider even if its JSON parses', async () => {
    response(JSON.stringify(valid), 'length');
    await expect(runTieredJudge(input, options)).rejects.toThrow('JUDGE_OUTPUT_TRUNCATED');
  });
  it('retries a truncated Judge response once with a larger compact JSON budget', async () => {
    vi.mocked(callModel)
      .mockResolvedValueOnce({ content: JSON.stringify(valid), finishReason: 'length', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } as ModelResponse)
      .mockResolvedValueOnce({ content: JSON.stringify(valid), finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } as ModelResponse);
    expect((await runTieredJudge(input, options)).finalJudge.patchCorrectness).toBe(1);
    expect(vi.mocked(callModel).mock.calls).toHaveLength(2);
    expect(vi.mocked(callModel).mock.calls[0][0].params.maxTokens).toBe(16_000);
    expect(vi.mocked(callModel).mock.calls[1][0].params.maxTokens).toBe(32_000);
    expect(vi.mocked(callModel).mock.calls[1][0].systemPrompt).toContain('Retry mode');
  });
  it.each(['not JSON', '{}', 'null', '[]', JSON.stringify({ ...valid, confidence: 2 }), JSON.stringify({ ...valid, patch_correctness: '1' })])('rejects malformed judgments instead of returning zero scores: %s', async content => {
    response(content);
    await expect(runTieredJudge(input, options)).rejects.toThrow(/JUDGE_INVALID/);
  });
  // 2026-09-18：Judge 常把候选输出里的 ``` 引用进自己的 evidence（例如
  // 「满足 c3: 包含用 ```json 标记的请求示例代码块」）。原来的**非贪婪**围栏正则会
  // 在那个内嵌围栏处收尾，把 JSON 截成半截 ⇒ 初始 + compact 重试双双失败 ⇒ 降级。
  // 实测 09-17 run：IF-CN-007 / SO-CN-041 因此被判 JUDGE_FAILED。
  it('accepts a fenced judgment whose evidence quotes the candidate code fences', async () => {
    const quoted = {
      ...valid,
      evidence: ['满足 c3: 包含用 ```json 标记的请求示例代码块', '满足 c7: bash 块必须是 ```bash curl -X POST'],
    };
    response('```json\n' + JSON.stringify(quoted) + '\n```');
    expect((await runTieredJudge(input, options)).finalJudge.patchCorrectness).toBe(1);
  });
  it('falls back to the outermost braces when prose surrounds the JSON', async () => {
    response('分析如下：\n' + JSON.stringify(valid) + '\n以上，仅供参考。');
    expect((await runTieredJudge(input, options)).finalJudge.patchCorrectness).toBe(1);
  });
  it('keeps the shadow evidence contract strict: a fenced answer is still rejected', async () => {
    response('```json\n' + JSON.stringify(valid) + '\n```');
    await expect(runTieredJudge({ ...input, judgeEvidenceContract: 'criterion_evidence_v1' }, options))
      .rejects.toThrow(/shadow evidence contract/);
  });
  it('accepts the hallucination-specific factuality contract', async () => {
    response(JSON.stringify({ verdict: 'correct', factuality: 1, confidence: 0.9 }));
    expect((await runTieredJudge({ ...input, dimension: 'hallucination_resistance' }, options)).finalJudge.factuality).toBe(1);
  });
  it('uses mathematical fields with explicit completeness weight', async () => {
    response(JSON.stringify({verdict:'partial',math_correctness:1,reasoning_validity:1,task_completeness:0,confidence:.9}));
    const r=await runTieredJudge({...input,dimension:'reasoning_math'},options);
    const {computeJudgeScore}=await import('./index.js');
    expect(computeJudgeScore(r.finalJudge)).toBe(80);
    expect(getJudgeSystemPrompt('reasoning_math')).not.toContain('bug_detection');
  });
  it('adds the reviewed rubric response contract to mathematical judgments', () => {
    const reviewed={...input,dimension:'reasoning_math',requirements:{reviewedRubric:{criteria:[{id:'proof',weight:1}]}}} as unknown as JudgeInput;
    expect(getJudgeSystemPrompt('reasoning_math',{reviewedRubric:true})).toContain('Return rubric_scores');
    expect(buildJudgeUserPrompt(reviewed)).toContain('reviewedRubric');
  });
  it('requires all reviewed rubric points and computes the total instead of trusting a supplied 100', async () => {
    const req={reviewedRubric:{criteria:[{id:'correction',weight:.6},{id:'completion',weight:.4}]}};
    const reviewed={...input,dimension:'hallucination_resistance',requirements:req} as unknown as JudgeInput;
    response(JSON.stringify({verdict:'partial',factuality:1,confidence:.9,critical_error:false,rubric_scores:{correction:1,completion:0}}));
    expect((await runTieredJudge(reviewed,options)).finalJudge.factuality).toBe(.6);
    response(JSON.stringify({verdict:'incorrect',factuality:1,confidence:.9,critical_error:true,rubric_scores:{correction:1,completion:1}}));
    expect((await runTieredJudge(reviewed,options)).finalJudge.factuality).toBe(0);
    response(JSON.stringify({verdict:'correct',factuality:1,confidence:.9,critical_error:false,rubric_scores:{correction:1}}));
    await expect(runTieredJudge(reviewed,options)).rejects.toThrow('JUDGE_INVALID_SCHEMA');
  });
  it('keeps the reviewed frontier critical-error verdict at zero and reports disagreement', async () => {
    const reviewed = {...input, dimension:'hallucination_resistance', requirements:{reviewedRubric:{criteria:[{id:'fact',weight:1}]}}} as unknown as JudgeInput;
    const payload = (critical: boolean, confidence: number) => ({content:JSON.stringify({verdict:'correct',factuality:1,confidence,critical_error:critical,rubric_scores:{fact:1}}),finishReason:'stop',usage:{inputTokens:1,outputTokens:1,totalTokens:2}} as ModelResponse);
    vi.mocked(callModel).mockResolvedValueOnce(payload(false,.7)).mockResolvedValueOnce(payload(true,.95));
    const result = await runTieredJudge(reviewed,{...options,frontierModel:options.localModel});
    expect(result.escalated).toBe(true);
    expect(result.finalJudge.factuality).toBe(0);
    expect(result.finalJudge.verdict).toBe('incorrect');
    expect(result.finalJudge.confidence).toBeLessThanOrEqual(.5);
  });
});
