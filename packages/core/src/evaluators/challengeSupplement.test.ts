import { describe, expect, it } from 'vitest';
import type { OutputMetadata, Scenario } from '@zxbench/types';
import { buildChallengePack, candidateQuestion, referenceAnswer } from '../evaluationLab/challengePack.js';
import { CHALLENGE_SUPPLEMENT_IDS, CHALLENGE_SUPPLEMENT_SOURCE_HASH, CHALLENGE_SUPPLEMENT_SOURCE_VERSION } from '../evaluationLab/challengeRelease.js';
import { challengeSupplementEvaluator } from './challengeSupplement.js';

const metadata = (patch: Partial<OutputMetadata> = {}): OutputMetadata => ({
  finishReason: 'stop', truncated: false, containsCodeBlock: false,
  containsFinalConclusion: true, outputLength: 10, outputTokens: 10,
  inputTokens: 10, maxTokens: 90000, incomplete: false, ...patch,
});

function scenario(id: string): Scenario {
  const item = buildChallengePack().cases.find((entry) => entry.id === id)!;
  return {
    id, dimension: item.dimension, category: 'challenge_supplement', difficulty: 'adversarial',
    language: 'json', locale: 'zh-CN', status: 'valid', tier: 'private_validation',
    promptTemplate: candidateQuestion(item).messages[1].content,
    grader: 'challenge_supplement', graderVersion: '1.0.0',
    scoring: { type: 'binary_pass_fail', weights: { challenge_strict: 1 } },
    requirements: { challengeId: id, sourcePackVersion: CHALLENGE_SUPPLEMENT_SOURCE_VERSION, sourcePackHash: CHALLENGE_SUPPLEMENT_SOURCE_HASH } as never,
    scenarioVersion: '1.0.0', scenarioHash: 'fixture',
  };
}

describe('challenge supplement evaluator', () => {
  it.each(CHALLENGE_SUPPLEMENT_IDS)('accepts deterministic gold for %s', async (id) => {
    const item = buildChallengePack().cases.find((entry) => entry.id === id)!;
    const result = await challengeSupplementEvaluator.evaluate(scenario(id), JSON.stringify(referenceAnswer(item)), metadata());
    expect(result).toMatchObject({ totalScore: 100, deterministicScore: 100, environmentError: false, humanReviewRequired: false });
    expect(result.axisEvidence).toEqual({ challenge_strict: 'verified' });
  });

  it('rejects wrong and truncated answers without a Judge', async () => {
    const s = scenario('MC2-001');
    expect(await challengeSupplementEvaluator.evaluate(s, '{}', metadata())).toMatchObject({ totalScore: 0, environmentError: false });
    const item = buildChallengePack().cases.find((entry) => entry.id === s.id)!;
    expect(await challengeSupplementEvaluator.evaluate(s, JSON.stringify(referenceAnswer(item)), metadata({ truncated: true }))).toMatchObject({ totalScore: 0 });
  });

  it('treats contract drift as unmeasured instead of model failure', async () => {
    const s = scenario('HC3-002');
    (s.requirements as unknown as Record<string, unknown>).sourcePackHash = 'stale';
    expect(await challengeSupplementEvaluator.evaluate(s, '{}', metadata())).toMatchObject({ environmentError: true, axisCoverage: 0 });
  });
});
