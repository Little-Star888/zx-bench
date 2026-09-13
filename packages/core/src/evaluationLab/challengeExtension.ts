import { snapshotHash } from '../contracts/pack.js';
import { buildChallengePack, candidateQuestion, referenceAnswer } from './challengePack.js';
import { buildAdaptiveProbability, probabilityReference } from './adaptiveProbability.js';
import { buildMc2004Revision } from './challengeMathRevision.js';

export const CHALLENGE_EXTENSION_VERSION = 'challenge-extension-2026-09-13-v1';
export const COVERAGE_CHALLENGE_IDS = [
  'HC3-001', 'HC3-003', 'HC3-004', 'HC3-006', 'HC2-005', 'HC2-008',
  'MC2-003', 'MC2-005', 'MC2-007', 'MC2-008', 'MC2-009', 'MC2-010', 'MC2-011', 'MC2-012',
] as const;

/** A separate release adapter; historical experimental packs stay immutable. */
export function buildChallengeExtension() {
  const source = buildChallengePack();
  const coverage = COVERAGE_CHALLENGE_IDS.map(id => {
    const item = source.cases.find(c => c.id === id)!;
    return { id, dimension: item.dimension, family: item.family, kind: 'coverage' as const,
      prompt: candidateQuestion(item).messages[1].content, reference: referenceAnswer(item),
      source: item, developmentShadow: false };
  });
  const probability = buildAdaptiveProbability(20260912).cases.map(item => ({
    id: item.id, dimension: 'reasoning_math' as const, family: item.family, kind: 'probability' as const,
    prompt: item.question.messages[0].content.replace(
      '无法明确提取答案时记为待审而非数学零分；附加证明正确性单独记录，不由文字长度决定数学分数。',
      '无法明确提取答案时标为未能验证，不推断数学答案错误；格式合规单独记录。仅核验五个最终概率，不评判附加证明。'),
    reference: probabilityReference(item.problem).answer, source: item, developmentShadow: false,
  }));
  const revision = buildMc2004Revision();
  const cases = [...coverage, ...probability, {
    id: revision.id, dimension: revision.dimension, family: revision.family, kind: 'revision' as const,
    prompt: candidateQuestion(revision).messages[1].content, reference: revision.reference,
    source: revision, developmentShadow: true,
  }];
  return { version: CHALLENGE_EXTENSION_VERSION, cases, hash: snapshotHash(cases) };
}
