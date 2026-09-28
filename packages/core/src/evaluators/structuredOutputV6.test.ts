import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Scenario } from '@zxbench/types';
import { summarizeCriteria } from '../audit.js';
import { structuredOutputEvaluator } from './structuredOutput.js';

const grade = (scenario: Scenario, output: string) => structuredOutputEvaluator.evaluate(scenario, output, {} as never, {} as never);

describe('structured output contract audit', () => {
  it('recognizes an XSD type attribute and rejects an absent type', async () => {
    const scenario = { grader: 'schema_compliance', requirements: {
      format: 'xml', requiredFields: ['xs:positiveInteger'], output_policy: 'raw_only',
    } } as unknown as Scenario;
    const good = await grade(scenario, '<xs:element name="quantity" type="xs:positiveInteger"/>');
    const restriction = await grade(scenario, '<xs:simpleType><xs:restriction base="xs:positiveInteger"/></xs:simpleType>');
    const bad = await grade(scenario, '<xs:element name="quantity" type="xs:string"/>');
    expect(good.axisScores?.field_constraints).toBe(100);
    expect(restriction.axisScores?.field_constraints).toBe(100);
    expect(bad.axisScores?.field_constraints).toBe(0);
  });

  it('keeps partial score and strict contract result independent', async () => {
    const scenario = { grader: 'schema_compliance', requirements: {
      format: 'json', output_policy: 'raw_only', schema: { type: 'object', required: ['count'],
        properties: { count: { type: 'integer' } }, additionalProperties: false },
      constraints: ['jsonEq:.={"count":3}'],
    } } as unknown as Scenario;
    const good = await grade(scenario, '{"count":3}');
    const reordered = await grade({ ...scenario, requirements: { ...scenario.requirements,
      constraints: ['jsonEq:.={"a":1,"b":2}'], schema: { type: 'object' } } } as Scenario, '{"b":2,"a":1}');
    const bad = await grade(scenario, '{"count":999}');
    expect(summarizeCriteria(good.criterionResults).strictPass).toBe(true);
    expect(summarizeCriteria(reordered.criterionResults).strictPass).toBe(true);
    expect(summarizeCriteria(bad.criterionResults).strictPass).toBe(false);
    expect(bad.totalScore).toBeGreaterThan(0);
  });

  it('accepts every pilot gold and rejects a value mutation', async () => {
    const scenarios = JSON.parse(readFileSync('data/pilots/structured-output-v2.json', 'utf8')) as Scenario[];
    const gold = JSON.parse(readFileSync('data/pilots/structured-output-v2-gold.json', 'utf8')) as Array<{ id: string; expected: Record<string, unknown> }>;
    expect(scenarios).toHaveLength(36);
    const byId = new Map(scenarios.map(s => [s.id, s]));
    for (const item of gold) {
      const scenario = byId.get(item.id)!;
      const good = await grade(scenario, JSON.stringify(item.expected));
      expect(summarizeCriteria(good.criterionResults).strictPass, item.id).toBe(true);
      const badOutput = { ...item.expected, unexpected: true };
      const bad = await grade(scenario, JSON.stringify(badOutput));
      expect(summarizeCriteria(bad.criterionResults).strictPass, item.id).toBe(false);
    }
  });

  it('catches the observed SO-CN-042 mutation classes in the prospective repair', async () => {
    const repairs = JSON.parse(readFileSync('data/pilots/structured-output-v2-repairs.json', 'utf8')) as Scenario[];
    const scenario = repairs.find(s => s.id === 'SO-CN-042')!;
    const constraints = (scenario.requirements as { constraints: string[] }).constraints;
    const fixture = (path: string) => JSON.parse(constraints.find(c => c.startsWith(`jsonEq:${path}=`))!.split('=').slice(1).join('='));
    const orders = fixture('orders') as Array<{ amount: number; tax: number; total: number; unitPrice: number }>;
    const good = { generatedAt: '2026-03-04T00:00:00Z', users: fixture('users'), orders,
      summary: { count: orders.length, itemsTotal: orders.reduce((n, x) => n + x.amount, 0),
        taxTotal: orders.reduce((n, x) => n + x.tax, 0), grandTotal: orders.reduce((n, x) => n + x.total, 0) } };
    expect(summarizeCriteria((await grade(scenario, JSON.stringify(good))).criterionResults).strictPass).toBe(true);
    const mutations = [
      (x: typeof good) => { x.summary.count = 999; },
      (x: typeof good) => { x.generatedAt = 'not-a-date'; },
      (x: typeof good) => { x.orders.forEach(row => { row.total = 0; }); x.summary.grandTotal = 0; },
      (x: typeof good) => { x.orders.forEach(row => { row.unitPrice = row.amount = row.tax = row.total = 0; });
        x.summary.itemsTotal = x.summary.taxTotal = x.summary.grandTotal = 0; },
    ];
    for (const mutate of mutations) {
      const bad = structuredClone(good);
      mutate(bad);
      const result = await grade(scenario, JSON.stringify(bad));
      expect(summarizeCriteria(result.criterionResults).strictPass).toBe(false);
      expect(result.totalScore).toBeLessThan(100);
    }
  });
});
