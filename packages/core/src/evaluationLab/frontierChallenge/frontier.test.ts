import { describe, expect, it } from 'vitest';
import { buildFrontierPack, gradeFrontierCase, scoreFrontier, type Submission } from './index.js';
import { solveOptimization, feasible, objective, gradeOptimization, type Optimization } from './optimization.js';
import { worlds, evidenceReference, gradeEvidence, buildEvidence, type Evidence } from './evidence.js';
import { ledgerReference, gradeLedger, type Ledger } from './extraction.js';

describe('global optimization oracle', () => {
  it('agrees with independent direct enumeration on mixed-sign constrained instances', () => {
    for (let seed = 0; seed < 8; seed++) {
      const p: Optimization = { n: 8, bias: Array.from({ length: 8 }, (_, i) => (i * 11 + seed) % 17 - 8), costs: [2, 3, 1, 5, 4, 2, 3, 1], budget: 14,
        minSelected: 2, maxSelected: 5, edges: [[0, 1, -5], [1, 3, 8], [3, 6, 7], [6, 0, -2], [2, 4, 9], [4, 7, 5], [5, 7, -4]], parityGroups: [{ members: [0, 2, 4, 6], parity: seed % 2 }], requires: [[3, 2], [7, 5]] };
      // Recompute objective and feasibility from each complete bit-vector; this
      // does not reuse Gray-code incremental updates.
      const all = Array.from({ length: 256 }, (_, mask) => ({ mask, value: objective(p, mask) })).filter(x => feasible(p, x.mask));
      const max = Math.max(...all.map(x => x.value)), gold = solveOptimization(p);
      expect(gold.value).toBe(max); expect(gold.feasibleCount).toBe(all.length); expect(gold.optimumCount).toBe(all.filter(x => x.value === max).length);
      expect(gradeOptimization(p, { value: gold.value, x: gold.x }).pass).toBe(true);
      const bad = all.find(x => x.value < max)!;
      const a = Array.from({ length: 8 }, (_, i) => (bad.mask >>> i) & 1), grade = gradeOptimization(p, { value: bad.value, x: a });
      expect(grade.pass).toBe(false); expect(grade.diagnostics?.witnessFeasible).toBe(true); expect(grade.diagnostics?.optimalityGap).toBeGreaterThan(0);
      expect(gradeOptimization(p, { value: max, x: Array(8).fill(0) }).pass).toBe(false);
    }
  });
});
describe('evidence entails a conclusion vs one possible explanation', () => {
  const p: Evidence = { names: ['A', 'B', 'C'], constraints: [{ id: 'r1', members: [0, 1], count: 1, kind: 'eq' }, { id: 'r2', members: [1, 2], count: 1, kind: 'eq' }],
    claims: [{ id: 'yes', members: [0, 1, 2], threshold: 1 }, { id: 'no', members: [0, 1, 2], threshold: 3 }, { id: 'unknown', members: [0, 2], threshold: 1 }] };
  it('matches hand-derived alternative worlds and rejects overclaiming', () => {
    expect(worlds(p)).toEqual([2, 5]);
    const g = evidenceReference(p);
    expect(g.claims.map(c => c.status)).toEqual(['supported', 'refuted', 'insufficient']);
    expect(gradeEvidence(p, g).score).toBe(100);
    const bad = structuredClone(g); bad.claims[2].status = 'supported'; bad.claims[2].false_world = null;
    expect(gradeEvidence(p, bad).score).toBeCloseTo(200 / 3);
    const invalid = structuredClone(g); invalid.claims[2].true_world = [1, 1, 1];
    expect(gradeEvidence(p, invalid).diagnostics?.statusAccuracy).toBe(100);
    expect(gradeEvidence(p, invalid).score).toBeCloseTo(200 / 3);
  });
  it('generates six composite claims across all stress tiers', () => {
    for (const tier of [1, 2, 3] as const) {
      const c = buildEvidence(20260915, tier), states = c.reference.claims.map((c: any) => c.status);
      expect(states.filter((s: string) => s === 'insufficient')).toHaveLength(2);
      expect(gradeEvidence(c.problem, c.reference).score).toBe(100);
    }
  }, 20000);
});
describe('ledger reconstruction', () => {
  it('replays after rollback so a later conditional transfer changes validity', () => {
    const p: Ledger = { cutoff: 90, bindings: [{ handle: 'a', entity_id: 'A', start: 0, end: 100 }, { handle: 'b', entity_id: 'B', start: 0, end: 100 }],
      decisions: [{ tx: 'base', revision: 1, recorded: 1, decision: 'commit' }, { tx: 'edit', revision: 1, recorded: 40, decision: 'commit' }, { tx: 'edit', revision: 2, recorded: 80, decision: 'abort' }],
      entries: [
        { id: '1', revision: 1, recorded: 10, time: 10, tx: 'base', handle: 'a', draft: false, op: { kind: 'put', values: { label: 'same', quantity: 5 } } },
        { id: '2', revision: 1, recorded: 11, time: 11, tx: 'base', handle: 'b', draft: false, op: { kind: 'put', values: { label: 'same', quantity: 1 } } },
        { id: '3', revision: 1, recorded: 20, time: 20, tx: 'edit', handle: 'a', draft: false, op: { kind: 'delta', amount: 10 } },
        { id: '4', revision: 1, recorded: 30, time: 30, tx: 'base', handle: 'a', draft: false, op: { kind: 'move', target: 'b', amount: 8 } },
        { id: '3', revision: 2, recorded: 89, time: 20, tx: 'base', handle: 'a', draft: true, op: { kind: 'delta', amount: 999 } },
      ] };
    expect(ledgerReference(p).records.map(r => r.quantity)).toEqual([5, 1]);
    const withoutAbort = structuredClone(p); withoutAbort.decisions.pop();
    expect(ledgerReference(withoutAbort).records.map(r => r.quantity)).toEqual([7, 9]);
    const answer = ledgerReference(p); expect(gradeLedger(p, answer).score).toBe(100);
    answer.records.forEach(r => { r.label = 'wrong'; r.quantity = 999; r.due_date = 'wrong'; r.owner = 'wrong'; });
    expect(gradeLedger(p, answer).score).toBe(20);
  });
});
describe('frozen pilot contract', () => {
  const pack = buildFrontierPack({ seed: 20260915, tiers: [1] });
  const input = (): Submission => ({ contractHash: pack.contractHash, runId: 'oracle-not-model', modelId: 'oracle', modelFamily: 'oracle', answers: pack.cases.map(c => ({ id: c.id, questionHash: c.question.questionHash, outcome: 'completed', output: JSON.stringify(c.reference) })) });
  it('validates every reference and separates formatting from content', () => {
    for (const c of pack.cases) { expect(gradeFrontierCase(c, JSON.stringify(c.reference)).contentPass).toBe(true);
      expect(gradeFrontierCase(c, `解释\n\`\`\`json\n${JSON.stringify(c.reference)}\n\`\`\``)).toMatchObject({ contentPass: true, formatCompliant: false }); }
  });
  it('retains coverage and rejects stale submissions', () => {
    const s = input(); s.answers[0].outcome = 'timeout';
    expect(scoreFrontier(pack, s).dimensions[0]).toMatchObject({ deliveredScore: 0, contentOnlyScore: null });
    s.answers.shift(); expect(scoreFrontier(pack, s).dimensions[0].deliveredScore).toBeNull();
    s.answers[0].questionHash = 'wrong'; expect(() => scoreFrontier(pack, s)).toThrow(/stale/);
  });
});
