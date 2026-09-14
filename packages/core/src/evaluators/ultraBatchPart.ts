import type { OutputMetadata, Scenario, ScenarioResult } from '@zxbench/types';
import type { Evaluator } from './index.js';
import { buildEvidenceExam, gradePart as gradeEvidencePart } from '../evaluationLab/evidenceExam/index.js';
import { buildExamPaper, gradePart as gradeMathPart } from '../evaluationLab/examExpansion/index.js';

const evidenceParts = new Map(buildEvidenceExam().parts.map(part => [part.id, part]));
const mathParts = new Map(buildExamPaper().parts.map(part => [part.id, part]));

export const ultraBatchPartEvaluator: Evaluator = {
  name: 'ultra_batch_part',
  version: '1.0.0',
  async evaluate(scenario: Scenario, modelOutput: string, _metadata: OutputMetadata): Promise<Partial<ScenarioResult>> {
    const evidencePart = evidenceParts.get(scenario.id);
    const mathPart = mathParts.get(scenario.id);
    if (!evidencePart && !mathPart) throw new Error(`Unknown ultra-batch part: ${scenario.id}`);
    const result = evidencePart ? gradeEvidencePart(evidencePart, modelOutput) : gradeMathPart(mathPart!, modelOutput);
    const score = Math.round(100 * result.earned / result.points);
    return {
      totalScore: score,
      deterministicScore: score,
      axisScores: { progressive_part: score },
      axisCoverage: 1,
      axisEvidence: { progressive_part: 'rule' },
      evidence: [`PROGRESSIVE_PART: earned=${result.earned}/${result.points}`],
      formatParseSuccess: result.rejectedRecords === 0 && !result.incompleteTail,
    };
  },
};

export const ultraProofPartEvaluator: Evaluator = {
  name: 'ultra_proof_part',
  version: '1.0.0',
  async evaluate(_scenario: Scenario, modelOutput: string): Promise<Partial<ScenarioResult>> {
    const submitted = modelOutput.trim().length > 0;
    return {
      totalScore: 0,
      deterministicScore: 0,
      axisScores: {},
      axisCoverage: 0,
      axisEvidence: {},
      evidence: [submitted ? 'PROOF_REQUIRES_RUBRIC_JUDGE' : 'NO_ANSWER_SUBMITTED'],
      formatParseSuccess: submitted,
    };
  },
};
