import { snapshotHash } from '../../contracts/pack.js';
import { exactKeys, numericEqual } from '../challengeTypes.js';
import { verifyLinearOptimization, type LinearOptimization } from '../linearOptimizationCertificate.js';
import { parseAnswer } from '../methodsV2/verify.js';
import { buildSampling, buildIdentification, buildOptimization, verifyIdentification,
  type IdentificationProblem } from './math.js';
import { buildJournal, verifyJournal, type JournalProblem } from './extraction.js';
import { buildEvidence, verifyEvidence, type EvidenceProblem } from './evidence.js';
import { STRUCTURAL_VERSION, shuffle, type StructuralCase, type ContentGrade } from './types.js';
export { STRUCTURAL_VERSION } from './types.js';
export type { StructuralCase } from './types.js';
export interface StructuralOptions { seed: number; instances: number; split: 'development' | 'confirmation' }
export function buildStructuralChallenge(options: StructuralOptions = { seed: 20260914, instances: 2, split: 'development' }) {
  if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0x7fffffff ||
      !Number.isInteger(options.instances) || options.instances < 1 || options.instances > 10 ||
      !['development', 'confirmation'].includes(options.split)) throw new Error('Invalid structural pack options');
  // Confirmation changes both the seed and IDs, but shares template families;
  // never describe it as unseen-family generalization or contamination-proof.
  const seed = options.split === 'confirmation' ? (options.seed ^ 0x56ab17) >>> 0 : options.seed;
  const cases = shuffle(Array.from({ length: options.instances }, (_, i) => [
    ...buildSampling(seed, i), ...buildIdentification(seed, i), ...buildOptimization(seed, i),
    ...buildJournal(seed, i), ...buildEvidence(seed, i),
  ]).flat(), seed);
  const policy = { version: STRUCTURAL_VERSION, candidateOnly: true, productionEligible: false, difficultyCalibrated: false,
    judgeCalls: 0, tools: false, primary: 'delivered_content_success_per_planned_item',
    missing: 'no_normalization_over_only_parseable_answers', aggregation: 'equal_family_content_with_coverage_and_pair_diagnostics',
    prose: 'unique_answer_certificate_only_not_free_form_proof_verification',
    split: 'new_instances_shared_families_not_unseen_family_holdout',
    history: 'no_best_of_no_automatic_retry_no_production_history_writes' };
  const pack = { options, policy, cases };
  return { ...pack, contractHash: snapshotHash(pack), questions: cases.map(c => c.question) };
}
export type StructuralPack = ReturnType<typeof buildStructuralChallenge>;
export function assertStructuralPack(pack: StructuralPack) {
  const fresh = buildStructuralChallenge(pack.options);
  if (snapshotHash(pack) !== snapshotHash(fresh)) throw new Error('Frozen structural pack mismatch');
}

/** No repair/best-of. Whole JSON or exactly one JSON fence with no second
 * object/array outside it. Prose is excluded from content grading explicitly. */
export function extractStructuralAnswer(output: string) {
  if (output.length > 1_000_000) return { answer: null, formatCompliant: false, reason: 'output_limit' };
  try { return { answer: parseAnswer(output), formatCompliant: true, reason: 'whole_json' }; } catch {}
  const fences = [...output.matchAll(/```(?:json)?\s*\r?\n([\s\S]*?)```/g)];
  if (fences.length !== 1) return { answer: null, formatCompliant: false, reason: 'ambiguous_or_missing_answer' };
  const match = fences[0], outside = output.slice(0, match.index) + output.slice(match.index! + match[0].length);
  if (/[\[\]{}]|```/.test(outside)) return { answer: null, formatCompliant: false, reason: 'multiple_answer_candidates' };
  try { return { answer: parseAnswer(match[1]), formatCompliant: !outside.trim(), reason: 'single_fenced_certificate' }; }
  catch { return { answer: null, formatCompliant: false, reason: 'invalid_json' }; }
}
export function gradeStructuralCase(item: StructuralCase, output: string) {
  const extraction = extractStructuralAnswer(output), v = extraction.answer;
  let grade: ContentGrade = { valid: false, checks: [] };
  if (v !== null) {
    if (item.family === 'sampling_measure') {
      const reference = item.reference as Record<string, unknown>, keys = Object.keys(reference);
      if (exactKeys(v, keys)) {
        const checks = keys.map(id => ({ id, pass: numericEqual(v[id], reference[id]) }));
        grade = { valid: true, checks, score: 100 * checks.filter(c => c.pass).length / checks.length };
      }
    } else if (item.family === 'latent_identification') grade = verifyIdentification(item.problem as IdentificationProblem, v);
    else if (item.family === 'optimization_status') {
      const g = verifyLinearOptimization(item.problem as LinearOptimization, v);
      grade = { valid: g.formatValid, checks: Object.entries(g.checks).map(([id, pass]) => ({ id, pass })) };
    } else if (item.family === 'transactional_reconstruction') grade = verifyJournal(item.problem as JournalProblem, v);
    else if (item.family === 'scoped_evidence_revision') grade = verifyEvidence(item.problem as EvidenceProblem, v);
    else throw new Error('Unknown structural family');
  }
  const pass = grade.valid && grade.checks.length > 0 && grade.checks.every(c => c.pass);
  return { measured: grade.valid, contentPass: grade.valid ? pass : null,
    contentScore: grade.valid ? (grade.score ?? (pass ? 100 : 0)) : null,
    formatCompliant: extraction.formatCompliant && grade.valid, checks: grade.checks, extraction: extraction.reason,
    contentScope: 'requested_answer_or_certificate_only' };
}
export interface StructuralAnswer { id: string; questionHash: string; outcome: 'completed' | 'timeout' | 'truncated' | 'environment_error'; output: string }
export interface StructuralSubmission { contractHash: string; runId: string; modelId: string; modelFamily: string; answers: StructuralAnswer[] }
export function scoreStructuralSubmission(pack: StructuralPack, input: StructuralSubmission) {
  assertStructuralPack(pack);
  if (input.contractHash !== pack.contractHash || [input.runId, input.modelId, input.modelFamily].some(v => typeof v !== 'string' || !v.trim()) || !Array.isArray(input.answers)) throw new Error('Invalid submission identity');
  const answers = new Map<string, StructuralAnswer>();
  for (const a of input.answers) {
    if (!exactKeys(a, ['id', 'questionHash', 'outcome', 'output']) || !['completed', 'timeout', 'truncated', 'environment_error'].includes(a.outcome) || typeof a.output !== 'string' ||
      answers.has(a.id) || !pack.cases.some(c => c.id === a.id && c.question.questionHash === a.questionHash)) throw new Error('Duplicate/unknown/stale answer');
    answers.set(a.id, a);
  }
  const rows = pack.cases.map(item => {
    const a = answers.get(item.id), g = a?.outcome === 'completed' ? gradeStructuralCase(item, a.output) : null;
    return { id: item.id, dimension: item.dimension, family: item.family, group: item.group, variant: item.variant,
      state: a?.outcome ?? 'missing', outputHash: a ? snapshotHash(a.output) : null,
      deliveredSuccess: g?.contentPass === true, ...g };
  });
  const families = [...new Set(rows.map(r => r.family))].map(family => {
    const a = rows.filter(r => r.family === family), infrastructureFailure = a.some(r => r.state === 'environment_error' || r.state === 'missing');
    return { family, dimension: a[0].dimension, planned: a.length, measured: a.filter(r => r.measured).length,
      deliveredPasses: a.filter(r => r.deliveredSuccess).length,
      // Time/format failures mean no answer delivered, not a verified mathematical falsehood.
      deliveredScore: infrastructureFailure ? null : a.reduce((s, r) => s + (r.contentScore ?? 0), 0) / a.length,
      formatRate: a.filter(r => r.formatCompliant).length / a.length,
      unmeasured: a.filter(r => !r.measured).map(r => ({ id: r.id, state: r.state, reason: r.extraction ?? null })) };
  });
  const groups = [...new Set(rows.map(r => r.group))].map(group => {
    const a = rows.filter(r => r.group === group);
    return { group, family: a[0].family, allVariantsDeliveredCorrectly: a.every(r => r.deliveredSuccess),
      variants: a.map(r => ({ variant: r.variant, pass: r.contentPass ?? null, state: r.state })) };
  });
  return { version: STRUCTURAL_VERSION, contractHash: pack.contractHash, runId: input.runId, modelId: input.modelId, modelFamily: input.modelFamily,
    rows, families, groups, dimensions: [...new Set(families.map(f => f.dimension))].map(dimension => {
      const a = families.filter(f => f.dimension === dimension);
      return { dimension, score: a.some(f => f.deliveredScore === null) ? null : a.reduce((s, f) => s + f.deliveredScore!, 0) / a.length,
        planned: a.reduce((s, f) => s + f.planned, 0), measured: a.reduce((s, f) => s + f.measured, 0) };
    }), productionEligible: false, difficultyCalibrated: false, combinedScore: null };
}
