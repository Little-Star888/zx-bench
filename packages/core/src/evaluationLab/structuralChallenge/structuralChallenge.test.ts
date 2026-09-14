import { describe, expect, it } from 'vitest';
import { buildStructuralChallenge, gradeStructuralCase, scoreStructuralSubmission, extractStructuralAnswer, type StructuralSubmission } from './index.js';
import { samplingReference, identificationReference, buildIdentification, buildOptimization } from './math.js';
import { journalReference, verifyJournal, type JournalProblem } from './extraction.js';
import { buildEvidence, type EvidenceProblem } from './evidence.js';

const pack = buildStructuralChallenge({ seed: 20260914, instances: 1, split: 'development' });
const submission = (): StructuralSubmission => ({ contractHash: pack.contractHash, runId: 'oracle-QA-NOT-model', modelId: 'reference', modelFamily: 'reference',
  answers: pack.cases.map(c => ({ id: c.id, questionHash: c.question.questionHash, outcome: 'completed', output: JSON.stringify(c.reference) })) });

describe('structural generator and exact oracles', () => {
  it('validates witnesses across seeds; same-size states and new mathematical instances', () => {
    const seen = new Set<string>();
    for (const seed of [0, 1, 2, 17, 101, 7919, 20260914, 2147483647]) {
      const p = buildStructuralChallenge({ seed, instances: 1, split: 'development' });
      expect(p.cases).toHaveLength(15);
      for (const c of p.cases) expect(gradeStructuralCase(c, JSON.stringify(c.reference)).contentPass, c.id).toBe(true);
      const ls = buildOptimization(seed, 0);
      expect(ls.map(c => [(c.problem as any).a.length, (c.problem as any).c.length])).toEqual([[8, 4], [8, 4], [8, 4]]);
      expect(buildIdentification(seed, 0).map(c => (c.reference as any).status).sort()).toEqual(['bounded', 'identified', 'inconsistent']);
      seen.add(JSON.stringify(p.cases.find(c => c.family === 'sampling_measure')!.problem));
    }
    expect(seen.size).toBe(8);
  });

  it('matches a hand-enumerated stopping experiment, including length-biased selection', () => {
    // One box R,R,G,B; cap 2, stop on G. Terminal paths have lengths 1 or 2.
    // P(first=G)=1/4; E(T)=7/4. Expected number of R records is 5/6.
    // Under uniform-experiment sampling: P(observe R)=(5/6)/2=5/12.
    // Under pooled records: P(observe R)=(5/6)/(7/4)=10/21.
    const base = { boxes: [[2, 1, 1]], prior: [1], cap: 2, stopColor: 1, stopCount: 1, observedColor: 0, nextColor: 1 };
    const a = samplingReference({ ...base, mechanism: 'experiment_then_record' });
    const b = samplingReference({ ...base, mechanism: 'pooled_records' });
    expect(a).toEqual({ observation_probability: '5/12', posterior_box0: '1', expected_length: '2', next_color_probability: '2/5' });
    expect(b).toEqual({ ...a, observation_probability: '10/21' });
  });

  it('distinguishes identification, sharp bounds and inconsistency with hand-solvable grids', () => {
    // a+b+c=3, a+2b+3c=6 => a=c and b=3-2a; a is 0 or 1.
    const p = { prior: [1, 1, 1], feature: [1, 2, 3], featureDenominator: 4, gateDenominator: 3, reportProbability: '1/3', featureGivenReport: '1/2' };
    expect(identificationReference(p)).toEqual({ status: 'bounded', lower: '0', upper: '1/3', lower_gate: [0, 3, 0], upper_gate: [1, 1, 1] });
    expect(identificationReference({ ...p, reportProbability: '1' }).status).toBe('identified');
    expect(identificationReference({ ...p, featureGivenReport: '7/16' }).status).toBe('inconsistent');
  });

  it('accepts a different valid Farkas certificate and rejects a false one', () => {
    const item = pack.cases.find(c => c.variant === 'infeasible')!, gold = item.reference as any;
    expect(gradeStructuralCase(item, JSON.stringify({ ...gold, y: gold.y.map((v: number) => v * 3) })).contentPass).toBe(true);
    expect(gradeStructuralCase(item, JSON.stringify({ ...gold, y: gold.y.map(() => 0) })).contentPass).toBe(false);
  });
});

describe('reconstruction and evidence semantics', () => {
  const journal: JournalProblem = { cutoff: 90,
    bindings: [{ handle: 'h', entity_id: 'a', start: 0, end: 20 }, { handle: 'h', entity_id: 'b', start: 20, end: 100 }],
    events: [
      { event_id: '1', tx: 'base', time: 10, handle: 'h', op: 'put', values: { label: 'same', quantity: 4, due_date: 'd' } },
      { event_id: '2', tx: 'base', time: 20, handle: 'h', op: 'put', values: { label: 'same', quantity: 5 } },
      { event_id: '3', tx: 'edit', time: 30, handle: 'h', op: 'patch', values: { quantity: 0, due_date: null } },
      { event_id: '4', tx: 'del', time: 40, handle: 'h', op: 'delete', values: {} },
    ], decisions: [
      { tx: 'base', time: 60, revision: 1, decision: 'commit' }, { tx: 'edit', time: 60, revision: 1, decision: 'commit' },
      { tx: 'del', time: 60, revision: 1, decision: 'commit' }, { tx: 'del', time: 70, revision: 2, decision: 'abort' },
      { tx: 'edit', time: 100, revision: 2, decision: 'abort' },
    ] };
  it('replays an explicit fixture with cutoff, handle reuse, rollback, null and duplicate delivery', () => {
    const wanted = { records: [{ entity_id: 'a', label: 'same', quantity: 4, due_date: 'd' }, { entity_id: 'b', label: 'same', quantity: 0, due_date: null }] };
    const p = structuredClone(journal); p.events.push(structuredClone(p.events[2])); p.events.reverse();
    expect(journalReference(p)).toEqual(wanted);
    expect(verifyJournal(p, { records: [...wanted.records].reverse() }).score).toBe(100);
    const wrong = { records: wanted.records.map(r => ({ ...r, label: 'wrong', quantity: 99, due_date: 'wrong' })) };
    expect(verifyJournal(p, wrong).score).toBe(25); // only entity IDs match; no format/schema baseline
    expect(verifyJournal(p, { records: [] }).score).toBe(0);
    expect(verifyJournal(p, { records: [...wanted.records, wanted.records[0]] }).valid).toBe(false);
  });
  it('keeps reorder controls equivalent and makes causal edits change reference content', () => {
    for (const family of ['transactional_reconstruction', 'scoped_evidence_revision']) {
      const cs = pack.cases.filter(c => c.family === family);
      const baseline = cs.find(c => ['committed', 'draft_correction'].includes(c.variant))!;
      expect(cs.find(c => c.variant === 'reordered')!.reference).toEqual(baseline.reference);
      const changed = cs.find(c => ['revoked', 'final_correction'].includes(c.variant))!;
      expect(changed.reference).not.toEqual(baseline.reference);
    }
  });
  it('does not reward blanket refusal; cites active evidence and scores each complete claim', () => {
    const cs = buildEvidence(20260914, 0), draft = cs[0], final = cs[1], identity = cs[2];
    const p = draft.problem as EvidenceProblem, aliasClaim = p.claims.find(c => c.scope.product === p.aliases[0].alias && c.value)!;
    const answer = (c: typeof draft) => (c.reference as any).claims.find((x: any) => x.id === aliasClaim.id);
    expect(answer(draft).status).toBe('supported');
    expect(answer(final).status).toBe('refuted');
    expect(answer(identity).status).toBe('refuted');
    const bad = structuredClone(draft.reference) as any;
    bad.claims.forEach((c: any) => { c.status = 'insufficient'; c.sources = []; });
    expect(gradeStructuralCase(draft, JSON.stringify(bad)).contentScore).toBeCloseTo(100 / 3);
    const single = structuredClone(final.reference) as any;
    single.claims.find((c: any) => c.id === aliasClaim.id).sources = answer(draft).sources;
    expect(gradeStructuralCase(final, JSON.stringify(single)).contentScore).toBeCloseTo(500 / 6);
  });
});

describe('delivery, format and frozen identity', () => {
  it('separates extra prose from answer correctness without repairing ambiguous answers', () => {
    const c = pack.cases[0], gold = JSON.stringify(c.reference);
    expect(gradeStructuralCase(c, `说明\n\`\`\`json\n${gold}\n\`\`\``)).toMatchObject({ contentPass: true, formatCompliant: false });
    for (const output of ['{"x":1,"x":2}', `\`\`\`json\n${gold}\n\`\`\`\n\`\`\`json\n${gold}\n\`\`\``, `${gold}\n${gold}`]) expect(extractStructuralAnswer(output).answer).toBeNull();
  });
  it('cannot hide missing/timeout answers by averaging only parsed successes', () => {
    const input = submission(), family = pack.cases[0].family;
    expect(scoreStructuralSubmission(pack, input).dimensions.every(d => d.score === 100)).toBe(true);
    input.answers[0].outcome = 'timeout';
    const timeout = scoreStructuralSubmission(pack, input);
    expect(timeout.rows[0].contentPass).toBeUndefined();
    expect(timeout.families.find(f => f.family === family)!.deliveredScore).toBeLessThan(100);
    input.answers.shift();
    expect(scoreStructuralSubmission(pack, input).families.find(f => f.family === family)!.deliveredScore).toBeNull();
  });
  it('rejects duplicate/stale IDs and tampered gold; public projection contains no answer or variant labels', () => {
    const input = submission(); input.answers.push(input.answers[0]);
    expect(() => scoreStructuralSubmission(pack, input)).toThrow(/Duplicate/);
    const stale = submission(); stale.answers[0].questionHash = 'old';
    expect(() => scoreStructuralSubmission(pack, stale)).toThrow(/stale/);
    const corrupt = structuredClone(pack); corrupt.cases[0].reference = {};
    expect(() => scoreStructuralSubmission(corrupt, submission())).toThrow(/mismatch/);
    for (const q of pack.questions) expect(Object.keys(q).sort()).toEqual(['dimension', 'id', 'messages', 'questionHash']);
    const confirmation = buildStructuralChallenge({ ...pack.options, split: 'confirmation' });
    expect(confirmation.contractHash).not.toBe(pack.contractHash);
    expect(confirmation.questions.some(q => pack.questions.some(p => p.id === q.id))).toBe(false);
  });
});
