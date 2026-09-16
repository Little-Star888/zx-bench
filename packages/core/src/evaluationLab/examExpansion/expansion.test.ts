import { describe, it, expect } from 'vitest';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExamPaper, referenceOutput, gradePart, scoreExam, validCertificate, exactAnswer, type Submission } from './index.js';
import { reserveModelCall, remainingModelCalls } from './callBudget.js';

describe('candidate expansion: targeted scoring and budget checks only', () => {
  it('keeps all 17 authoring groups well-formed and verifies reference certificates', () => {
    const p = buildExamPaper();
    // 2026-09-16：新增 MX3-13~17 五个高难度题组（20 小问），12 -> 17 组、48 -> 68 小问。
    expect(p.groups).toHaveLength(17); expect(p.parts).toHaveLength(68);
    for (const part of p.parts) {
      expect(part.points).toBe([10, 20, 30, 40][part.number - 1]);
      expect(gradePart(part, referenceOutput(part)).earned, part.id).toBe(part.points);
    }
    expect(exactAnswer(['1/2', true], ['2/4', 'true'])).toBe(false);
    expect(exactAnswer(['1/2', true], ['2/4', true])).toBe(true);
  });

  it('accepts different valid certificates and rejects plausible but invalid witnesses', () => {
    const p = buildExamPaper();
    // 证书题的落点随设计调整：MX3-03 的对偶证书在 P3、MX3-02 的流/割证书在 P3（P4 已改为结构分析题）
    const assignment = p.parts.find(x => x.id === 'MX3-03-P3')!.items.find(x => x.kind === 'assignment')!;
    if (assignment.kind !== 'assignment') throw Error();
    const a = structuredClone(assignment.reference) as { u: string[]; v: string[]; permutation: string[]; value: string };
    a.u = a.u.map(x => String(Number(x) + 7)); a.v = a.v.map(x => String(Number(x) - 7));
    expect(validCertificate(assignment, a)).toBe(true); // dual gauge, not exact reference match
    a.permutation[0] = a.permutation[1]; expect(validCertificate(assignment, a)).toBe(false);
    const flow = p.parts.find(x => x.id === 'MX3-02-P3')!.items.find(x => x.kind === 'flow')!;
    if (flow.kind !== 'flow') throw Error();
    const f = structuredClone(flow.reference) as { flow: string[]; cut: string[] };
    f.cut.reverse(); expect(validCertificate(flow, f)).toBe(true);
    f.flow[0] = String(Number(f.flow[0]) - 1); expect(validCertificate(flow, f)).toBe(false);
    const moment = p.parts.find(x => x.id === 'MX3-12-P4')!.items.find(x => x.kind === 'moment')!;
    if (moment.kind !== 'moment') throw Error();
    const m = structuredClone(moment.reference) as { weights: string[] };
    m.weights[0] = '-1/15'; expect(validCertificate(moment, m)).toBe(false);
  });

  it('retains earlier and within-part points on truncation, but cannot rank incomplete runs', () => {
    const p = buildExamPaper({ groupIds: ['MX3-12'] });
    const input: Submission = { contractHash: p.contractHash, runId: 'synthetic', modelId: 'synthetic', modelFamily: 'synthetic',
      answers: p.parts.map(part => ({ id: part.id, questionHash: part.question.questionHash, outcome: 'completed', output: referenceOutput(part) })) };
    input.answers[3].outcome = 'truncated';
    input.answers[3].output = referenceOutput(p.parts[3]).split('\n')[0] + '\n{"item":"certificate","answer":';
    expect(scoreExam(p, input).score).toBe(70);
    input.answers.pop(); expect(scoreExam(p, input)).toMatchObject({ score: null, earned: 60 });
  });

  it('enforces a shared finite call budget without making network requests', () => {
    const dir = mkdtempSync(join(tmpdir(), 'exam-budget-'));
    try {
      for (let i = 1; i <= 16; i++) expect(reserveModelCall(dir, { synthetic: true, model: i % 2 })).toBe(i);
      expect(remainingModelCalls(dir)).toBe(0);
      expect(() => reserveModelCall(dir, { synthetic: true })).toThrow('exhausted');
    } finally { for (const f of readdirSync(dir)) unlinkSync(join(dir, f)); rmdirSync(dir); }
  });
});
