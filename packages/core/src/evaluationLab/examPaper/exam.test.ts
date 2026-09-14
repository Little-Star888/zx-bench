import { describe, expect, it } from 'vitest';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { examStream as apiControlStream } from './stream.js';
import { buildExamPaper, committedItems, examMessages, gradePart, referenceOutput, scoreExam, type ExamSubmission } from './index.js';
import { bits } from '../frontierChallenge/types.js';
import { feasible, objective } from '../frontierChallenge/optimization.js';

const paper = buildExamPaper();
const complete = (): ExamSubmission => ({ contractHash: paper.contractHash, runId: 'test', modelId: 'test', modelFamily: 'test',
  answers: paper.parts.map(p => ({ id: p.id, questionHash: p.question.questionHash, outcome: 'completed', output: referenceOutput(p) })) });

describe('progressive timed exam', () => {
  it('preserves earlier points and scores complete items inside a timed-out or truncated part', () => {
    const a = complete();
    a.answers[3] = { ...a.answers[3], outcome: 'truncated', output: '{"item":"solution","answer":' };
    a.answers[7] = { ...a.answers[7], outcome: 'timeout', output: referenceOutput(paper.parts[7]).split('\n').slice(0, 2).join('\n') + '\n{"item":"equal_3","answer":' };
    const scored = scoreExam(paper, a);
    expect(scored.groups[0].earned).toBe(60);
    expect(scored.groups[1].earned).toBe(74);
    expect(scored.score).toBe(67);
    expect(scored.rows[7].incompleteTail).toBe(true);
    expect(scored.comparable).toBe(true);
    const full = scoreExam(paper, complete());
    expect(full.score).toBe(100);
    expect(paper.parts.filter(p => p.number >= 3).every(p => p.hardSeconds === 1200)).toBe(true);
  });
  it('retains earned points but excludes infrastructure failures and unattempted parts from comparable totals', () => {
    const a = complete(); a.answers[3].outcome = 'environment_error';
    expect(scoreExam(paper, a)).toMatchObject({ earned: 200, comparable: false, score: null });
    a.answers.pop(); expect(scoreExam(paper, a).score).toBeNull();
    a.answers[0].questionHash = 'stale'; expect(() => scoreExam(paper, a)).toThrow();
    const b = complete(); b.answers.push(b.answers[0]); expect(() => scoreExam(paper, b)).toThrow();
  });
  it('uses the last complete submitted revision; malformed or incomplete tails never erase earlier work', () => {
    const parsed = committedItems('```json\n{"item":"a","answer":4}\n{"item":"a","answer":5}\n{"item":"b","answer":7,"answer":8}\n{"item":"other","answer":1}\n{"item":"a","answer":', ['a', 'b']);
    expect([...parsed.items]).toEqual([['a', 5]]); expect(parsed.rejected).toBe(2); expect(parsed.incompleteTail).toBe(true);
    expect(committedItems('{"item":"a","answer":{"text":"braces } { and \\\" quote"}}', ['a']).accepted).toBe(1);
    const part = paper.parts[4];
    expect(gradePart(part, referenceOutput(part) + '\n{"item":"d","answer":99}').earned).toBe(7);
  });
  it('gives a near-optimal feasible solution graduated points without pretending it is globally optimal', () => {
    const part = paper.parts[2], item = part.items[0];
    if (item.kind !== 'targets') throw new Error('Unexpected fixture');
    const candidates = Array.from({ length: 2 ** item.problem.n }, (_, mask) => mask).filter(mask => feasible(item.problem, mask));
    const mask = candidates.find(mask => objective(item.problem, mask) >= item.targets![1] && objective(item.problem, mask) < item.targets![2])!;
    const answer = { value: objective(item.problem, mask), x: bits(mask, item.problem.n) };
    const output = JSON.stringify({ item: 'solution', answer });
    expect(gradePart(part, output).earned).toBe(20);
    expect(gradePart(paper.parts[3], output).earned).toBe(0);
    expect(gradePart(paper.parts[1], output).earned).toBe(20);
    answer.value++; expect(gradePart(part, JSON.stringify({ item: 'solution', answer })).earned).toBe(0);
    expect(gradePart(paper.parts[1], JSON.stringify({ item: 'solution', answer })).earned).toBe(15);
  });
  it('carries prior submitted answers only, without gold feedback or cross-question leakage', () => {
    const a = complete(); a.answers[0].output = '{"item":"value","answer":-999}\n{"item":"cost","answer":';
    const messages = examMessages(paper, paper.parts[1], a.answers);
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[1].content).toBe('{"item":"value","answer":-999}');
    expect(examMessages(paper, paper.parts[4], a.answers)).toHaveLength(1);
    expect(messages.some(m => m.content.includes('"earned":'))).toBe(false);
  });
  it('keeps streamed completed items on both token truncation and a real deadline abort', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zx-exam-test-'));
    const event = (content: string, finish: string | null = null) => 'data: ' + JSON.stringify({ model: 'test', choices: [{ delta: { content }, finish_reason: finish }] }) + '\n\n';
    const part = paper.parts[7], line = referenceOutput(part).split('\n')[0];
    const o = { endpoint: 'https://example.invalid', key: 'fake', body: {}, wireFile: join(dir, 'wire'), stopFile: join(dir, 'STOP'), timeoutMs: 100 };
    try {
      const truncated = await apiControlStream(o, async () => new Response(event(line + '\n{"item":"equal_2","answer":', 'length') + 'data: [DONE]\n\n'));
      expect(truncated.error).toBe('truncated'); expect(gradePart(part, truncated.content).earned).toBe(7);
      const timed = await apiControlStream(o, async (_url, _key, _body, signal) => new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(event(line + '\n{"item":"equal_2","answer":')));
        signal.addEventListener('abort', () => controller.error(new Error('deadline')), { once: true });
      } })));
      expect(timed.error).toBe('timeout_or_cancelled'); expect(gradePart(part, timed.content).earned).toBe(7);
    } finally { unlinkSync(o.wireFile); rmdirSync(dir); }
  });
});
