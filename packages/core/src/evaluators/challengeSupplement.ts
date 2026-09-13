import type { AxisEvidence, OutputMetadata, Scenario, ScenarioResult } from '@zxbench/types';
import type { Evaluator } from './index.js';
import { buildChallengePack, gradeChallenge } from '../evaluationLab/challengePack.js';
import {
  CHALLENGE_SUPPLEMENT_GRADER_VERSION,
  CHALLENGE_SUPPLEMENT_ID_SET,
  CHALLENGE_SUPPLEMENT_SOURCE_HASH,
  CHALLENGE_SUPPLEMENT_SOURCE_VERSION,
} from '../evaluationLab/challengeRelease.js';

function gradingUnavailable(message: string): Partial<ScenarioResult> {
  return {
    axisScores: { challenge_strict: 0 },
    axisEvidence: { challenge_strict: 'unmeasured' },
    axisCoverage: 0,
    totalScore: 0,
    deterministicScore: 0,
    environmentError: true,
    humanReviewRequired: false,
    safetyLevel: 'safe',
    evidence: [`GRADING_UNAVAILABLE: ${message}`],
  };
}

/** Deterministic, binary scorer for the five prospectively frozen challenge items. */
export const challengeSupplementEvaluator: Evaluator = {
  name: 'challenge_supplement',
  version: CHALLENGE_SUPPLEMENT_GRADER_VERSION,

  async evaluate(
    scenario: Scenario,
    modelOutput: string,
    outputMetadata: OutputMetadata,
  ): Promise<Partial<ScenarioResult>> {
    const requirements = (scenario.requirements ?? {}) as unknown as Record<string, unknown>;
    const challengeId = String(requirements.challengeId ?? scenario.id);
    if (!CHALLENGE_SUPPLEMENT_ID_SET.has(challengeId) || challengeId !== scenario.id) {
      return gradingUnavailable(`scenario ${scenario.id} is not in the frozen supplement allowlist`);
    }

    const pack = buildChallengePack();
    if (pack.version !== CHALLENGE_SUPPLEMENT_SOURCE_VERSION || pack.hash !== CHALLENGE_SUPPLEMENT_SOURCE_HASH ||
        requirements.sourcePackVersion !== pack.version || requirements.sourcePackHash !== pack.hash) {
      return gradingUnavailable('source pack version/hash does not match the frozen scoring contract');
    }
    const challenge = pack.cases.find((item) => item.id === challengeId);
    if (!challenge) return gradingUnavailable(`challenge ${challengeId} is missing from its source pack`);

    const complete = !outputMetadata.truncated && !outputMetadata.incomplete &&
      outputMetadata.finishReason !== 'length' && outputMetadata.finishReason !== 'error';
    const grade = gradeChallenge(challenge, modelOutput, complete);
    const score = grade.strictPass ? 100 : 0;
    const axisEvidence: Record<string, AxisEvidence> = { challenge_strict: 'verified' };
    const passed = grade.checks.filter((check) => check.pass).length;
    return {
      axisScores: { challenge_strict: score },
      axisEvidence,
      axisCoverage: 1,
      totalScore: score,
      deterministicScore: score,
      formatParseSuccess: grade.formatValid,
      environmentError: false,
      humanReviewRequired: false,
      safetyLevel: 'safe',
      evidence: [
        `FROZEN_CHALLENGE: ${challengeId} strict=${grade.strictPass} checks=${passed}/${grade.checks.length}`,
        ...(grade.error ? [`DETAIL: ${grade.error}`] : []),
      ],
    };
  },
};
