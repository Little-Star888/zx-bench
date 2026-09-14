import { expect, it } from 'vitest';
import { buildStructuralChallenge, type StructuralSubmission } from './index.js';
import { screenStructuralRuns } from './screen.js';
const pack = buildStructuralChallenge({ seed: 123, instances: 1, split: 'development' });
const run = (id: string, family: string): StructuralSubmission => ({ contractHash: pack.contractHash, runId: id, modelId: id, modelFamily: family,
  answers: pack.cases.map(c => ({ id: c.id, questionHash: c.question.questionHash, outcome: 'completed', output: JSON.stringify(c.reference) })) });
it('flags reference-like ceiling as a rejection signal, never as successful difficulty calibration', () => {
  const s = screenStructuralRuns(pack, [run('a', 'A'), run('b', 'B')]);
  expect(s.families.every(f => f.signal === 'observed_ceiling_in_measured_models')).toBe(true);
  expect(s.productionEligible).toBe(false);
  expect(s.families.every(f => f.independentInstances === 1)).toBe(true);
});
it('cannot turn a timeout, invalid format or a quantized sibling into cross-family content separation', () => {
  const good = run('a', 'A'), bad = run('b', 'A');
  bad.answers.forEach(a => { a.outcome = 'timeout'; a.output = ''; });
  const s = screenStructuralRuns(pack, [good, bad]);
  expect(s.families.every(f => f.independentModelFamilies === 1 && f.spread === 0)).toBe(true);
  expect(s.families.every(f => f.models[1].contentScore === null && f.models[1].deliveredScore === 0)).toBe(true);
});
