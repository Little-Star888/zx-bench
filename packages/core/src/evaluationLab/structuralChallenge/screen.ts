import { scoreStructuralSubmission, type StructuralPack, type StructuralSubmission } from './index.js';

/** Descriptive screening only. It cannot promote a bank or manufacture an IRT
 * calibration from correlated variants of a handful of independent instances. */
export function screenStructuralRuns(pack: StructuralPack, submissions: StructuralSubmission[]) {
  if (!submissions.length || new Set(submissions.map(s => s.runId)).size !== submissions.length) throw new Error('Supply unique runs');
  const runs = submissions.map(s => scoreStructuralSubmission(pack, s));
  const families = runs[0].families.map(f => {
    const models = runs.map(run => {
      const rows = run.rows.filter(r => r.family === f.family), full = rows.every(r => r.state === 'completed' && r.measured);
      return { runId: run.runId, modelId: run.modelId, modelFamily: run.modelFamily,
        recorded: rows.filter(r => r.state !== 'missing').length, planned: rows.length,
        fullyMeasured: full, contentScore: full ? rows.reduce((s, r) => s + r.contentScore!, 0) / rows.length : null,
        deliveredScore: run.families.find(x => x.family === f.family)!.deliveredScore,
        formatRate: run.families.find(x => x.family === f.family)!.formatRate,
        failures: rows.filter(r => r.state !== 'completed' || !r.measured).map(r => ({ id: r.id, state: r.state })) };
    });
    const eligible = models.filter(m => m.fullyMeasured), independentModelFamilies = new Set(eligible.map(m => m.modelFamily)).size;
    const scores = eligible.map(m => m.contentScore!), min = scores.length ? Math.min(...scores) : null, max = scores.length ? Math.max(...scores) : null;
    const instanceGroups = new Set(pack.cases.filter(c => c.family === f.family).map(c => c.group)).size;
    const signal = min !== null && min >= 95 ? 'observed_ceiling_in_measured_models'
      : max !== null && max <= 20 && independentModelFamilies >= 2 ? 'observed_floor_in_measured_models'
      : min !== null && max! - min >= 10 && independentModelFamilies >= 2 ? 'exploratory_content_separation'
      : eligible.length !== runs.length ? 'insufficient_coverage' : 'no_clear_content_separation';
    return { family: f.family, dimension: f.dimension, independentInstances: instanceGroups, independentModelFamilies, models, min, max,
      spread: min === null ? null : max! - min, signal,
      calibrationBlockers: [
        ...(independentModelFamilies < 3 ? ['fewer_than_three_measured_model_families'] : []),
        ...(instanceGroups < 4 ? ['fewer_than_four_independent_instances'] : []),
        ...(eligible.length !== runs.length ? ['incomplete_model_coverage'] : []),
        'independent_confirmation_and_error_review_required',
      ], productionEligible: false };
  });
  return { version: pack.policy.version, contractHash: pack.contractHash, families,
    scope: 'descriptive_same_pack_screen; caller_must_disclose_decoding_and_budget_conditions',
    confidenceIntervals: null, reason: 'too_few_independent_instances_for_claimed_precision; variants_are_clustered',
    difficultyCalibrated: false, productionEligible: false, combinedScore: null };
}
