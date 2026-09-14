import { expect, it } from 'vitest';
import { buildFrontierPack, type Submission } from './index.js';
import { screenFrontier } from './screen.js';
const pack = buildFrontierPack({ seed: 20260915, tiers: [1] });
const run = (id: string): Submission => ({ contractHash: pack.contractHash, runId: id, modelId: id, modelFamily: id, answers: pack.cases.map(c => ({ id: c.id, questionHash: c.question.questionHash, outcome: 'completed', output: JSON.stringify(c.reference) })) });
it('cannot mistake a budget failure for content separation or promote an all-zero floor', () => {
  const a = run('a'), b = run('b');
  b.answers[0].outcome = 'timeout';
  const first = screenFrontier(pack, [a, b]);
  expect(first.cells[0].signal).toBe('not_comparable_coverage_or_model_families');
  expect(first.cells[0].contentSpread).toBeNull();
  const index = pack.cases.findIndex(c => c.dimension === 'reasoning_math');
  for (const r of [a, b]) r.answers[index].output = JSON.stringify({ value: 0, x: Array(16).fill(0) });
  const floor = screenFrontier(pack, [a, b]).cells[index];
  expect(floor.signal).toBe('observed_floor'); expect(floor.productionEligible).toBe(false);
});
