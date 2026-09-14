import type { ScenarioResult } from '@zxbench/types';
import type { Evaluator } from './index.js';
import { buildChallengeExtension } from '../evaluationLab/challengeExtension.js';
import { gradeChallenge } from '../evaluationLab/challengePack.js';
import { verifyAdaptiveProbability } from '../evaluationLab/adaptiveProbability.js';
import { gradeMc2004Revision } from '../evaluationLab/challengeMathRevision.js';
import { certificateDiagnostic } from '../evaluationLab/certificateDiagnostic.js';
import { parseAnswer } from '../evaluationLab/methodsV2/verify.js';

let frozen: ReturnType<typeof buildChallengeExtension> | undefined;
function unavailable(message: string): Partial<ScenarioResult> {
  return { totalScore: 0, deterministicScore: 0, axisCoverage: 0, environmentError: true,
    humanReviewRequired: false, axisScores: {}, axisEvidence: {},
    evidence: [`GRADING_UNAVAILABLE: ${message}`] };
}

export const challengeExtensionEvaluator: Evaluator = {
  name: 'challenge_extension', version: '1.1.0', compatibleVersions: ['1.0.0'],
  async evaluate(scenario, output, metadata) {
    const pack = frozen ??= buildChallengeExtension();
    const requirements = scenario.requirements as unknown as Record<string, unknown>;
    const item = pack.cases.find(c => c.id === scenario.id);
    if (!item || requirements?.challengeId !== item.id || requirements.sourcePackHash !== pack.hash ||
        requirements.sourcePackVersion !== pack.version || scenario.promptTemplate !== item.prompt || scenario.dimension !== item.dimension) {
      return unavailable('challenge extension definition does not match the frozen source');
    }
    const complete = !metadata.truncated && !metadata.incomplete && !['length', 'error'].includes(metadata.finishReason ?? '');
    let pass = false;
    let formatValid = false;
    let score = 0;
    let challengeAnswerScore = 0;
    let evidenceScore: number | undefined;
    let diagnostics: string[] = [];
    if (item.kind === 'coverage') {
      const grade = gradeChallenge(item.source, output, complete);
      pass = grade.strictPass;
      formatValid = grade.formatValid;
      const answerChecks = grade.checks.filter(check => check.id.endsWith('.answer'));
      const sourceChecks = grade.checks.filter(check => check.id.endsWith('.sources'));
      challengeAnswerScore = answerChecks.length
        ? Math.round(answerChecks.filter(check => check.pass).length / answerChecks.length * 100)
        : 0;
      evidenceScore = sourceChecks.length
        ? Math.round(sourceChecks.filter(check => check.pass).length / sourceChecks.length * 100)
        : undefined;
      score = complete && formatValid && grade.accuracy !== null ? Math.round(grade.accuracy * 100) : 0;
      diagnostics = [
        ...grade.checks.filter(check => !check.pass).map(check => `FAILED_CHECK:${check.id}`),
        ...(grade.citationDiagnostics ?? []).filter(d => !d.sufficient || !d.relevant)
          .map(d => `CITATION_DIAGNOSTIC:${d.field}:sufficient=${d.sufficient}:relevant=${d.relevant}:unsupported=${d.unsupportedSources.join('/')}`),
      ];
    } else if (item.kind === 'probability') {
      const grade = verifyAdaptiveProbability(item.source, output);
      if (!grade.formatValid) return { ...unavailable('probability answer could not be extracted unambiguously; mathematical accuracy unmeasured'), formatParseSuccess: false };
      pass = grade.pass && complete;
      formatValid = true;
      score = pass ? 100 : 0;
      challengeAnswerScore = score;
    } else {
      const extraction = certificateDiagnostic(output);
      if (extraction.certificate !== null) {
        const grade = gradeMc2004Revision(parseAnswer(extraction.certificate));
        pass = grade.strictPass && complete;
        formatValid = grade.formatValid;
        score = pass ? 100 : 0;
        challengeAnswerScore = score;
      }
    }
    return { totalScore: score, deterministicScore: score, axisScores: {
        challenge_answer: challengeAnswerScore,
        ...(evidenceScore === undefined ? {} : { evidence_attribution: evidenceScore }),
        format_compliance: formatValid ? 100 : 0,
      },
      axisEvidence: {
        challenge_answer: 'verified',
        ...(evidenceScore === undefined ? {} : { evidence_attribution: 'verified' as const }),
        format_compliance: 'rule',
      }, axisCoverage: 1,
      formatParseSuccess: formatValid, environmentError: false, humanReviewRequired: false, safetyLevel: 'safe',
      evidence: [`CHALLENGE_EXTENSION: ${item.id} kind=${item.kind} complete=${complete} strictPass=${pass} score=${score}`,
        ...diagnostics, 'PROOF_SCOPE: final answers / requested certificates only; prose proof correctness is not inferred'] };
  },
};
