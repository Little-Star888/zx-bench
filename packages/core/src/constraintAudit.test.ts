// F4（2026-09-16）：运行级约束的机械核验必须落入 criterionResults。
// 此前只有 instruction_checklist 会写该字段，导致 quality.constraintMetrics 恒为
// {samples, scoredSamples:0, unscoredSamples:samples, strictPassRate:null}——
// 「先答模式 / 硬止损」这类已下发且影响分数的约束从未被校验。
import { describe, expect, it } from 'vitest';
import type { ScenarioResult } from '@zxbench/types';
import { buildConstraintCriteria, resolveVisibleRationale } from './orchestrator.js';
import { summarizeCriteria } from './audit.js';

type Probe = Pick<ScenarioResult, 'modelOutput' | 'outputMetadata'>;
const probe = (modelOutput: string, outputMetadata: Partial<ScenarioResult['outputMetadata']> = {}): Probe =>
  ({ modelOutput, outputMetadata: { outputTokens: 10, inputTokens: 10, ...outputMetadata } as ScenarioResult['outputMetadata'] });

describe('buildConstraintCriteria', () => {
  it('returns nothing when the run has no verifiable constraints', () => {
    expect(buildConstraintCriteria({}, probe('ANSWER: 1'))).toEqual([]);
  });

  it('passes answerFirst when the first non-empty line is the answer line', () => {
    const criteria = buildConstraintCriteria({ answerFirst: true }, probe('\n\nANSWER: 顺序=J3,J1\n\n推导：...'));
    expect(criteria).toHaveLength(1);
    expect(criteria[0]).toMatchObject({ id: 'answer_first', status: 'pass', source: 'rule' });
    expect(summarizeCriteria(criteria).strictPass).toBe(true);
  });

  it('fails answerFirst when the answer is buried after prose', () => {
    const criteria = buildConstraintCriteria({ answerFirst: true }, probe('先分析一下：\n\nANSWER: 1'));
    expect(criteria[0].status).toBe('fail');
    expect(summarizeCriteria(criteria).strictPass).toBe(false);
  });

  it('marks answerFirst unmeasured when there is no output at all', () => {
    const criteria = buildConstraintCriteria({ answerFirst: true }, probe('   '));
    expect(criteria[0].status).toBe('unmeasured');
    expect(summarizeCriteria(criteria).measured).toBe(0);
  });

  it('accepts an unlabeled first line when strict answer-only mode forbids wrappers', () => {
    const criteria = buildConstraintCriteria(
      { answerFirst: true, visibleRationale: 'forbidden' },
      probe('1\n2\n3（三）'),
    );
    expect(criteria[0]).toMatchObject({ id: 'answer_first', status: 'pass' });
  });

  it('fails the critical time-limit criterion when the hard limit fired', () => {
    const criteria = buildConstraintCriteria({ hardTimeLimitMs: 1200000 }, probe('', {
      incompleteReasons: ['HARD_TIME_LIMIT: Model call timed out after 1200000ms'],
    }));
    expect(criteria[0]).toMatchObject({ id: 'hard_time_limit', status: 'fail', critical: true });
    expect(summarizeCriteria(criteria).criticalPass).toBe(false);
  });

  it('passes the time-limit criterion for a normally completed sample', () => {
    const criteria = buildConstraintCriteria({ hardTimeLimitMs: 1200000 }, probe('ANSWER: 1'));
    expect(criteria[0].status).toBe('pass');
  });

  it('checks the token budget only when usage was actually reported', () => {
    expect(buildConstraintCriteria({ maxTotalTokens: 100 }, probe('ANSWER: 1', { outputTokens: 0, inputTokens: 0 }))[0].status)
      .toBe('unmeasured');
    expect(buildConstraintCriteria({ maxTotalTokens: 100 }, probe('ANSWER: 1', { outputTokens: 40, inputTokens: 40 }))[0].status)
      .toBe('pass');
    expect(buildConstraintCriteria({ maxTotalTokens: 100 }, probe('ANSWER: 1', { outputTokens: 80, inputTokens: 80 }))[0].status)
      .toBe('fail');
  });

  it('reports all active constraints together', () => {
    const criteria = buildConstraintCriteria(
      { answerFirst: true, hardTimeLimitMs: 60000, maxTotalTokens: 100 },
      probe('ANSWER: 1', { outputTokens: 40, inputTokens: 40 }),
    );
    expect(criteria.map(c => c.id)).toEqual(['answer_first', 'hard_time_limit', 'token_budget']);
    expect(summarizeCriteria(criteria)).toMatchObject({ total: 3, measured: 3, passed: 3, strictPass: true });
  });
});

describe('resolveVisibleRationale', () => {
  const scenario = (overrides: Record<string, unknown> = {}) => ({
    dimension: 'program',
    grader: 'code_repair',
    promptTemplate: '修复这个问题并说明验证方法。',
    ...overrides,
  }) as Parameters<typeof resolveVisibleRationale>[0];

  it('forbids visible rationale for instruction-following and raw-only contracts', () => {
    expect(resolveVisibleRationale(scenario({ dimension: 'instruction_following', grader: 'instruction_checklist' }))).toBe('forbidden');
    expect(resolveVisibleRationale(scenario({ outputPolicy: 'raw_only' }))).toBe('forbidden');
  });

  it('detects exact-output wording outside the known strict dimensions', () => {
    expect(resolveVisibleRationale(scenario({ promptTemplate: '恰好输出 5 行，不要添加任何说明文字。' }))).toBe('forbidden');
  });

  it('keeps ordinary tasks automatic and honors an explicit run override', () => {
    expect(resolveVisibleRationale(scenario())).toBe('auto');
    expect(resolveVisibleRationale(scenario(), 'required')).toBe('required');
  });
});
