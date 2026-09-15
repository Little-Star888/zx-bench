import { describe, it, expect } from 'vitest';
import {
  DIMENSION_WEIGHTS,
  computeWeightedTotal,
  getJudgeWeights,
  mixDeterministicJudge,
  applyCoverageDiscount,
  computeDifficultyWeightedDimAvgs,
  LONG_TASK_WEIGHT,
  classifyEngineeringFailure,
  createDimAvgExclusionStats,
  applyReviewedVerdict,
} from './scoring.js';
import type { JudgeResult, ScenarioResult } from '@zxbench/types';

describe('computeWeightedTotal', () => {
  it('returns 0 for empty input', () => {
    expect(computeWeightedTotal(new Map())).toBe(0);
  });

  it('returns 100 when every dimension scores 100', () => {
    const m = new Map();
    for (const d of Object.keys(DIMENSION_WEIGHTS)) m.set(d, 100);
    expect(computeWeightedTotal(m)).toBe(100);
  });

  it('normalizes weights: a single dimension passes through its score', () => {
    expect(computeWeightedTotal(new Map([['program', 75]]))).toBe(75);
  });

  it('DIMENSION_WEIGHTS sums to 1.0', () => {
    const sum = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('computes the weighted-total formula exactly', () => {
    const m = new Map([['program', 80], ['reasoning_math', 50]]);
    expect(computeWeightedTotal(m)).toBeCloseTo(68.75, 2);
  });
});

describe('getJudgeWeights', () => {
  const cases = [
    ['data_extraction', '', 1.0, 0.0],
    ['safety_authority', '', 1.0, 0.0],
    ['hallucination_resistance', '', 0.3, 0.7],
    ['structured_output', '', 0.9, 0.1],
    ['reasoning_math', '', 0.95, 0.05],
    ['program', '', 0.8, 0.2],
    ['bug_finding', '', 0.4, 0.6],
    ['instruction_following', '', 0.5, 0.5],
    ['agent_workflow', '', 0.85, 0.15],
    ['tool_cli_workflow', '', 0.85, 0.15],
    ['cli_deep_tasks', '', 0.3, 0.7],
    ['cli_deep_tasks', 'exact_answer_line', 0.95, 0.05],
    ['unknown_dim', '', 0.6, 0.4],
  ];
  for (const c of cases) {
    it(c[0] + ' -> det=' + c[2] + ' judge=' + c[3], () => {
      const w = getJudgeWeights(c[0], c[1]);
      expect(w.deterministic).toBeCloseTo(c[2], 5);
      expect(w.judge).toBeCloseTo(c[3], 5);
      expect(w.deterministic + w.judge).toBeCloseTo(1.0, 5);
    });
  }
});

describe('mixDeterministicJudge (coverage-aware handoff, I1 judge cap)', () => {
  it('preserves total weight across coverage levels', () => {
    for (const c of [0, 0.15, 0.5, 0.8, 1]) {
      const m = mixDeterministicJudge(0.7, 0.3, c);
      expect(m.detW + m.judgeW).toBeCloseTo(1.0, 5);
    }
  });

  it('caps judge weight at JUDGE_WEIGHT_CAP (0.3), excess handed back to deterministic', () => {
    // 低覆盖 0.15：rawJudgeW = 0.3 + 0.7×0.85 = 0.895 → 封顶 0.3，detW = 0.7
    const m = mixDeterministicJudge(0.7, 0.3, 0.15);
    expect(m.judgeW).toBeCloseTo(0.3, 5);
    expect(m.detW).toBeCloseTo(0.7, 5);
  });

  it('keeps raw judge weight when below cap (high coverage)', () => {
    // 覆盖 0.9：rawJudgeW = 0.3 + 0.7×0.1 = 0.37 > 0.3 → 仍封顶
    const m = mixDeterministicJudge(0.7, 0.3, 0.9);
    expect(m.judgeW).toBeCloseTo(0.3, 5);
    expect(m.detW).toBeCloseTo(0.7, 5);
  });

  it('does not cap when raw judge weight is naturally below cap', () => {
    // program 维度 det=0.8 judge=0.2, coverage=1 → rawJudgeW = 0.2 < 0.3，原样保留
    const m = mixDeterministicJudge(0.8, 0.2, 1);
    expect(m.judgeW).toBeCloseTo(0.2, 5);
    expect(m.detW).toBeCloseTo(0.8, 5);
  });

  it('I1 regression: program AG 场景 judge 权重从 57% 压回 30%', () => {
    // 实测 AG 覆盖 0.53：修复前 judgeW = 0.2 + 0.8×0.47 ≈ 0.576 → 修复后 0.3
    const m = mixDeterministicJudge(0.8, 0.2, 0.53);
    expect(m.judgeW).toBeCloseTo(0.3, 5);
    expect(m.detW).toBeCloseTo(0.7, 5);
    expect(m.detW + m.judgeW).toBeCloseTo(1.0, 5);
  });
});

describe('applyCoverageDiscount (regression: the GLM5.2 under-scoring bug)', () => {
  it('does not discount when coverage >= 0.5', () => {
    expect(applyCoverageDiscount(80, 0.5)).toBe(80);
    expect(applyCoverageDiscount(80, 1)).toBe(80);
  });

  it('discounts totalScore to 30% when coverage < 0.5', () => {
    expect(applyCoverageDiscount(80, 0.4)).toBe(24);
  });

  it('contract: only totalScore is discounted, deterministicScore stays raw', () => {
    const raw = 80;
    const coverage = 0.15;
    const totalScore = applyCoverageDiscount(raw, coverage);
    const deterministicScore = raw;
    expect(totalScore).toBe(24);
    expect(deterministicScore).toBe(80);
    expect(deterministicScore).not.toBe(totalScore);
  });
});

describe('computeDifficultyWeightedDimAvgs (pure)', () => {
  it('weights hard questions higher than easy ones', () => {
    const results = [
      { scenarioId: 'a', dimension: 'program', totalScore: 90 },
      { scenarioId: 'b', dimension: 'program', totalScore: 60 },
    ];
    const lookup = new Map([['a', 'hard'], ['b', 'easy']]);
    const avgs = computeDifficultyWeightedDimAvgs(results, lookup);
    expect(avgs.get('program')).toBeCloseTo(80, 5);
  });

  it('falls back to medium weight for unknown difficulty', () => {
    const results = [{ scenarioId: 'x', dimension: 'program', totalScore: 80 }];
    const avgs = computeDifficultyWeightedDimAvgs(results, new Map());
    expect(avgs.get('program')).toBe(80);
  });

  it('groups averages independently per dimension', () => {
    const results = [
      { scenarioId: 'a', dimension: 'program', totalScore: 100 },
      { scenarioId: 'b', dimension: 'reasoning_math', totalScore: 50 },
    ];
    const lookup = new Map([['a', 'medium'], ['b', 'medium']]);
    const avgs = computeDifficultyWeightedDimAvgs(results, lookup);
    expect(avgs.get('program')).toBe(100);
    expect(avgs.get('reasoning_math')).toBe(50);
  });

  it('weightOverrideLookup overrides difficulty weight (long_task 3.0 > adversarial 2.5)', () => {
    // 长任务 a 得 0 分（权重 3.0），普通 adversarial b 得 100 分（权重 2.5）
    const results = [
      { scenarioId: 'a', dimension: 'program', totalScore: 0 },
      { scenarioId: 'b', dimension: 'program', totalScore: 100 },
    ];
    const lookup = new Map([['a', 'adversarial'], ['b', 'adversarial']]);
    const override = new Map([['a', LONG_TASK_WEIGHT]]);
    const avgs = computeDifficultyWeightedDimAvgs(results, lookup, undefined, override);
    // 均分 = (0*3.0 + 100*2.5) / 5.5
    expect(avgs.get('program')).toBeCloseTo((100 * 2.5) / 5.5, 5);
    // 无覆盖时两者同为 adversarial 2.5 → 均分 50
    const avgsNoOverride = computeDifficultyWeightedDimAvgs(results, lookup);
    expect(avgsNoOverride.get('program')).toBe(50);
  });

  it('weightOverrideLookup does not interfere with attackLevel multiplier', () => {
    // attackLevel 乘子与显式覆盖独立：覆盖题不应再吃难度权重
    const results = [{ scenarioId: 'a', dimension: 'hallucination_resistance', totalScore: 60 }];
    const lookup = new Map([['a', 'hard']]);
    const attack = new Map([['a', 'L4']]);
    const override = new Map([['a', 3.0]]);
    const avgs = computeDifficultyWeightedDimAvgs(results, lookup, attack, override);
    // 权重 = 3.0 × 2.0(L4) = 6.0；均分仍为 60（单题）
    expect(avgs.get('hallucination_resistance')).toBe(60);
  });
});

describe('classifyEngineeringFailure (P0 noise exclusion, 2026-09-14)', () => {
  it('flags environmentError as environment_error', () => {
    expect(classifyEngineeringFailure({ environmentError: true })).toBe('environment_error');
  });

  it('flags missing evaluator evidence as no_evaluator (DB JSON string form)', () => {
    const evidence = JSON.stringify(['No evaluator found for exact_answer_line@exact_answer_v2', 'Sample marked as incomplete (truncated)']);
    expect(classifyEngineeringFailure({ evidence })).toBe('no_evaluator');
  });

  it('flags empty-output evidence as empty_output (array form)', () => {
    expect(classifyEngineeringFailure({ evidence: ['Empty model output'] })).toBe('empty_output');
    expect(classifyEngineeringFailure({ evidence: ['Model returned empty response: length (output tokens: 4096)'] })).toBe('empty_output');
  });

  it('flags explicit blank modelOutput as empty_output', () => {
    expect(classifyEngineeringFailure({ modelOutput: '   ' })).toBe('empty_output');
  });

  it('does NOT flag truncated-with-content samples (partial signal preserved)', () => {
    // 截断但有内容：只是 'Sample marked as incomplete' 证据，不剔除
    expect(classifyEngineeringFailure({ evidence: ['Sample marked as incomplete (truncated)'] })).toBeNull();
    expect(classifyEngineeringFailure({ evidence: ['Output truncated: true'] })).toBeNull();
  });

  it('does NOT flag normal samples', () => {
    expect(classifyEngineeringFailure({ environmentError: false, evidence: ['ANSWER matched'], modelOutput: 'ANSWER: 42' })).toBeNull();
    expect(classifyEngineeringFailure({})).toBeNull();
    expect(classifyEngineeringFailure({ evidence: 'not-json-string' })).toBeNull();
  });

  it('does not infer empty output when modelOutput is undefined (aggregation mappings omit it)', () => {
    expect(classifyEngineeringFailure({ evidence: [] })).toBeNull();
  });

  // P0（2026-09-16）：运行级 constraints 触发的中断走 buildLimitExceededResult，
  // 证据前缀是 HARD_TIME_LIMIT / REASONING_TOKEN_BUDGET，与「模型空响应」不同，
  // 此前完全漏判，导致 09-15 run 15 条无作答样本被当成 0 分能力样本计入维度均分。
  it('flags hard-time-limit termination as limit_exceeded', () => {
    expect(classifyEngineeringFailure({
      evidence: ['HARD_TIME_LIMIT: Model call timed out after 1200000ms — hard time limit reached', 'NO_ANSWER_SUBMITTED'],
    })).toBe('limit_exceeded');
  });

  it('flags reasoning-budget exhaustion as limit_exceeded', () => {
    expect(classifyEngineeringFailure({
      evidence: ['REASONING_TOKEN_BUDGET: reasoning exhausted maxTokens=98192, output tokens=98192 (empty output, thinking consumed the budget)'],
    })).toBe('limit_exceeded');
  });

  it('does not let the limit prefix leak onto ordinary evidence', () => {
    // 前缀必须锚定行首，避免把正文里提到该词条的样本误判为工程失败
    expect(classifyEngineeringFailure({ evidence: ['Answer incorrect (accuracy: 0); see HARD_TIME_LIMIT handling'] })).toBeNull();
    expect(classifyEngineeringFailure({ evidence: ['Extracted answer: "REASONING_TOKEN_BUDGET: 1"'] })).toBeNull();
  });

  it('keeps environment_error and no_evaluator precedence over limit_exceeded', () => {
    expect(classifyEngineeringFailure({
      environmentError: true,
      evidence: ['HARD_TIME_LIMIT: timed out'],
    })).toBe('environment_error');
    expect(classifyEngineeringFailure({
      evidence: ['No evaluator found for ultra_proof_part@1.0.0', 'HARD_TIME_LIMIT: timed out'],
    })).toBe('no_evaluator');
  });
});

describe('computeDifficultyWeightedDimAvgs — engineering failure exclusion (P0)', () => {
  const lookup = new Map([['a', 'medium'], ['b', 'medium'], ['c', 'medium'], ['d', 'medium']]);

  it('excludes empty-output and no-evaluator samples from the average', () => {
    const results = [
      { scenarioId: 'a', dimension: 'reasoning_math', totalScore: 80 },
      { scenarioId: 'b', dimension: 'reasoning_math', totalScore: 0, evidence: ['Empty model output'] },
      { scenarioId: 'c', dimension: 'reasoning_math', totalScore: 0, evidence: JSON.stringify(['No evaluator found for x@y']) },
      { scenarioId: 'd', dimension: 'reasoning_math', totalScore: 60 },
    ];
    const stats = createDimAvgExclusionStats();
    const avgs = computeDifficultyWeightedDimAvgs(results, lookup, undefined, undefined, stats);
    // 剔除 b、c 后均分 = (80+60)/2 = 70（旧行为会得到 35）
    expect(avgs.get('reasoning_math')).toBe(70);
    expect(stats.excludedTotal).toBe(2);
    expect(stats.excludedByKind.get('empty_output')).toBe(1);
    expect(stats.excludedByKind.get('no_evaluator')).toBe(1);
    expect(stats.excludedByDimension.get('reasoning_math')).toBe(2);
  });

  it('environmentError exclusion counts toward stats when provided', () => {
    const results = [
      { scenarioId: 'a', dimension: 'program', totalScore: 90, environmentError: true },
      { scenarioId: 'b', dimension: 'program', totalScore: 50 },
    ];
    const stats = createDimAvgExclusionStats();
    const avgs = computeDifficultyWeightedDimAvgs(results, lookup, undefined, undefined, stats);
    expect(avgs.get('program')).toBe(50);
    expect(stats.excludedByKind.get('environment_error')).toBe(1);
  });

  it('without statsOut the behavior is exclusion-only (backward compatible call shape)', () => {
    const results = [
      { scenarioId: 'a', dimension: 'program', totalScore: 100 },
      { scenarioId: 'b', dimension: 'program', totalScore: 0, evidence: ['Empty model output'] },
    ];
    const avgs = computeDifficultyWeightedDimAvgs(results, lookup);
    expect(avgs.get('program')).toBe(100);
  });

  // ultra_proof_part：det=0 / judge=1，评分器只产占位证据。Judge 未跑成时必须判为
  // 「无法评分」而非「答错 0 分」，否则 Judge 不可用时整个证明题组静默归零并入均分。
  it('marks an unjudged proof rubric part as ungradable instead of a zero', () => {
    const unjudged: Partial<ScenarioResult> = { totalScore: 0, evidence: ['PROOF_REQUIRES_RUBRIC_JUDGE'] };
    applyReviewedVerdict(unjudged);
    expect(unjudged.environmentError).toBe(true);
    expect(unjudged.humanReviewRequired).toBe(true);
    expect(unjudged.evidence?.some(e => e.startsWith('GRADING_UNAVAILABLE'))).toBe(true);
    expect(classifyEngineeringFailure({ environmentError: unjudged.environmentError, evidence: unjudged.evidence }))
      .toBe('environment_error');
  });

  it('leaves a successfully judged proof part alone', () => {
    const judged: Partial<ScenarioResult> = {
      totalScore: 100, evidence: ['PROOF_REQUIRES_RUBRIC_JUDGE'], judgeScore: 100,
    };
    applyReviewedVerdict(judged, { factuality: 1 } as JudgeResult);
    expect(judged.environmentError).toBeUndefined();
    expect(judged.totalScore).toBe(100);
  });

  // P0（2026-09-16）：硬约束中断样本必须与空输出同等隔离，否则维度均分被测量伪影压低。
  it('excludes hard-limit terminations from the dimension average', () => {
    const results = [
      { scenarioId: 'a', dimension: 'reasoning_math', totalScore: 100 },
      { scenarioId: 'b', dimension: 'reasoning_math', totalScore: 0, evidence: ['HARD_TIME_LIMIT: Model call timed out after 1200000ms'] },
      { scenarioId: 'c', dimension: 'reasoning_math', totalScore: 0, evidence: ['REASONING_TOKEN_BUDGET: reasoning exhausted maxTokens=98192'] },
      { scenarioId: 'd', dimension: 'reasoning_math', totalScore: 80 },
    ];
    const stats = createDimAvgExclusionStats();
    const avgs = computeDifficultyWeightedDimAvgs(results, lookup, undefined, undefined, stats);
    // 剔除 b、c（均为 medium，权重相同）后 = (100+80)/2 = 90
    expect(avgs.get('reasoning_math')).toBe(90);
    expect(stats.excludedByKind.get('limit_exceeded')).toBe(2);
    expect(stats.excludedByDimension.get('reasoning_math')).toBe(2);
  });
});
