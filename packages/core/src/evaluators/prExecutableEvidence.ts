import type { Evaluator } from './index.js';
import { evaluatePrSqlWitness } from '../evaluationLab/prWitnessSql.js';
import { evaluatePrShardingWitness } from '../evaluationLab/prWitnessSharding.js';

export const prExecutableEvidenceEvaluator: Evaluator = {
  name: 'pr_executable_evidence',
  version: '1.0.0',
  async evaluate(scenario, output) {
    if (scenario.id === 'PR-ELITE-012') {
      const result = await evaluatePrSqlWitness(output);
      const witness = result.evidence.filter(e => e.phase === 'original_witness');
      const repairs = result.evidence.filter(e => e.phase.startsWith('candidate'));
      const witnessScore = witness.length && witness.every(e => e.passed) ? 100 : 0;
      const repairScore = repairs.length ? Math.round(100 * repairs.filter(e => e.passed).length / repairs.length) : 0;
      const infrastructure = result.status === 'infrastructure_unavailable' || result.status === 'reference_control_invalid' || result.status === 'world_configuration_invalid';
      return {
        axisScores: { replayable_witness: witnessScore, executable_repair: repairScore },
        axisEvidence: { replayable_witness: infrastructure ? 'unmeasured' : 'verified', executable_repair: infrastructure ? 'unmeasured' : 'verified' },
        totalScore: result.accepted ? 100 : 0, axisCoverage: infrastructure ? 0 : 1,
        environmentError: infrastructure, humanReviewRequired: false, safetyLevel: 'safe',
        evidence: [`PR_EXECUTABLE_SQL:${result.status}`, ...result.evidence.map(e => `${e.phase}/${e.worldId}/${e.id}:${e.passed ? 'PASS' : 'FAIL'}`)],
      };
    }
    if (scenario.id === 'PR-ELITE-013') {
      const result = evaluatePrShardingWitness(output);
      const witness = result.checks.filter(c => c.phase === 'witness');
      const repairs = result.checks.filter(c => c.phase === 'regression');
      return {
        axisScores: {
          replayable_witness: witness.length ? Math.round(100 * witness.filter(c => c.passed).length / witness.length) : 0,
          executable_repair: repairs.length ? Math.round(100 * repairs.filter(c => c.passed).length / repairs.length) : 0,
        },
        axisEvidence: { replayable_witness: 'verified', executable_repair: 'verified' },
        totalScore: result.accepted ? 100 : 0, axisCoverage: 1,
        environmentError: false, humanReviewRequired: false, safetyLevel: 'safe',
        evidence: [`PR_EXECUTABLE_SHARDING:${result.status}`, ...result.checks.map(c => `${c.phase}/${c.id}:${c.passed ? 'PASS' : 'FAIL'}:${c.detail}`)],
      };
    }
    return { totalScore: 0, axisCoverage: 0, environmentError: true, humanReviewRequired: false,
      safetyLevel: 'safe', evidence: [`CONFIG_ERROR: unsupported executable PR scenario ${scenario.id}`] };
  },
};
