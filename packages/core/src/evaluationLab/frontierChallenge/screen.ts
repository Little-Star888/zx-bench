import { scoreFrontier, type Pack, type Submission } from './index.js';
export function screenFrontier(pack: Pack, inputs: Submission[]) {
  if (!inputs.length || new Set(inputs.map(i => i.runId)).size !== inputs.length) throw new Error('Unique runs required');
  const runs = inputs.map(i => scoreFrontier(pack, i));
  const cells = pack.cases.map(c => {
    const models = runs.map(run => ({ modelId: run.modelId, modelFamily: run.modelFamily, ...run.rows.find(r => r.id === c.id)! }));
    const full = models.every(m => m.state === 'completed' && m.measured), independent = new Set(models.map(m => m.modelFamily)).size;
    const values = models.map(m => m.contentScore ?? 0), low = Math.min(...values), high = Math.max(...values);
    const signal = !full || independent < 2 ? 'not_comparable_coverage_or_model_families' : low >= 95 ? 'observed_ceiling'
      : high <= 5 ? 'observed_floor' : high - low >= 10 ? 'exploratory_content_separation' : 'small_or_no_content_separation';
    const statuses = models.map(m => (m.diagnostics as {statusAccuracy?:number} | null)?.statusAccuracy);
    return { id: c.id, tier: c.tier, dimension: c.dimension, family: c.family, independentModelFamilies: independent,
      independentInstances: 1, models, contentSpread: full ? high - low : null, signal,
      witnessOnlyGap: c.dimension === 'hallucination_resistance' && full && high !== low && statuses.every(s => s === statuses[0]),
      productionEligible: false };
  });
  return { version: pack.policy.version, contractHash: pack.contractHash, cells, productionEligible: false, difficultyCalibrated: false,
    note: 'Each tier is one different instance. No confidence interval, IRT fit, aggregate leaderboard, or claim of monotonic difficulty. Timeouts and format failures cannot establish content separation.',
    followup: 'Content separation requires fresh-instance replication and additional model families. Floor requires calibration downward; ceiling requires replacement.' };
}
