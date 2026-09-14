import { snapshotHash } from '../../contracts/pack.js';
import { exactKeys } from '../challengeTypes.js';
import { extractStructuralAnswer } from '../structuralChallenge/index.js';
import { buildOptimization, gradeOptimization } from './optimization.js';
import { buildEvidence, gradeEvidence } from './evidence.js';
import { buildLedger, gradeLedger } from './extraction.js';
import { VERSION, type Case, type Tier } from './types.js';
export { VERSION } from './types.js';
export interface Options { seed: number; tiers: Tier[] }
export function buildFrontierPack(options: Options = { seed: 20260915, tiers: [1, 2, 3] }) {
  if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0x7fffffff || !options.tiers.length || new Set(options.tiers).size !== options.tiers.length || options.tiers.some(t => ![1, 2, 3].includes(t))) throw new Error('Invalid frontier options');
  // Run extraction/evidence before lengthy optimization. Fixed order, independent contexts.
  const cases = options.tiers.flatMap(t => [buildLedger(options.seed, t), buildEvidence(options.seed, t), buildOptimization(options.seed, t)]);
  const policy = { version: VERSION, tools: false, judgeCalls: 0, productionEligible: false, difficultyCalibrated: false,
    primary: 'per_family_and_tier_content_scores_with_coverage', optimization: 'exact_optimum_plus_feasible_witness; optimality_gap_separate',
    hallucination: 'grounded_claim_accuracy_and_status_accuracy_separate', extraction: 'field_content_micro_f1_no_format_baseline',
    development: 'one_instance_per_tier_is_a_probe_not_calibration', outputFormat: 'inherited_unique_json_answer_policy', combinedScore: null };
  return { options, policy, cases, contractHash: snapshotHash({ options, policy, cases }), questions: cases.map(c => c.question) };
}
export type Pack = ReturnType<typeof buildFrontierPack>;
export function assertFrontierPack(pack: Pack) {
  if (snapshotHash(pack) !== snapshotHash(buildFrontierPack(pack.options))) throw new Error('Frozen frontier pack mismatch');
}
export function gradeFrontierCase(c: Case, output: string) {
  const parsed = extractStructuralAnswer(output);
  const g = parsed.answer === null ? { valid: false, pass: false, score: null } : c.dimension === 'reasoning_math' ? gradeOptimization(c.problem, parsed.answer)
    : c.dimension === 'hallucination_resistance' ? gradeEvidence(c.problem, parsed.answer) : gradeLedger(c.problem, parsed.answer);
  return { measured: g.valid, contentPass: g.valid ? g.pass : null, contentScore: g.score, formatCompliant: g.valid && parsed.formatCompliant,
    extraction: parsed.reason, diagnostics: 'diagnostics' in g ? g.diagnostics : null };
}
export interface Answer { id: string; questionHash: string; outcome: 'completed' | 'timeout' | 'truncated' | 'environment_error'; output: string }
export interface Submission { contractHash: string; runId: string; modelId: string; modelFamily: string; answers: Answer[] }
export function scoreFrontier(pack: Pack, input: Submission) {
  assertFrontierPack(pack);
  if (input.contractHash !== pack.contractHash || [input.runId, input.modelId, input.modelFamily].some(s => typeof s !== 'string' || !s.trim()) || !Array.isArray(input.answers)) throw new Error('Invalid submission');
  const seen = new Set<string>();
  for (const a of input.answers) {
    if (!exactKeys(a, ['id', 'questionHash', 'outcome', 'output']) || seen.has(a.id) || typeof a.output !== 'string' || !['completed', 'timeout', 'truncated', 'environment_error'].includes(a.outcome) || !pack.questions.some(q => q.id === a.id && q.questionHash === a.questionHash)) throw new Error('Duplicate/unknown/stale answer'); seen.add(a.id);
  }
  const rows = pack.cases.map(c => { const a = input.answers.find(a => a.id === c.id), g = a?.outcome === 'completed' ? gradeFrontierCase(c, a.output) : null;
    return { id: c.id, tier: c.tier, dimension: c.dimension, family: c.family, state: a?.outcome ?? 'missing', ...g }; });
  return { version: VERSION, contractHash: pack.contractHash, modelId: input.modelId, modelFamily: input.modelFamily, runId: input.runId, rows,
    dimensions: [...new Set(rows.map(r => r.dimension))].map(dimension => {
      const a = rows.filter(r => r.dimension === dimension);
      return { dimension, planned: a.length, measured: a.filter(r => r.measured).length,
        deliveredScore: a.some(r => ['missing', 'environment_error'].includes(r.state)) ? null : a.reduce((s, r) => s + (r.contentScore ?? 0), 0) / a.length,
        contentOnlyScore: a.every(r => r.measured) ? a.reduce((s, r) => s + r.contentScore!, 0) / a.length : null };
    }), combinedScore: null, productionEligible: false, difficultyCalibrated: false };
}
