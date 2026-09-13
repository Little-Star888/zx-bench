import { describe, it, expect } from 'vitest';
import type { Scenario } from '@zxbench/types';
import { validateScenario } from './contracts/validateScenario.js';
import { getGraderContract } from './contracts/registry.js';
import { canonicalizeScenario, hashScenario, hashScenarioShort } from './contracts/canonicalize.js';
import { checkScenarioEligibility } from './contracts/eligibility.js';

/** 构造最小合法 scenario fixture */
function baseScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'FIX-001',
    dimension: 'reasoning_math',
    category: 'arithmetic',
    difficulty: 'easy',
    language: 'general',
    locale: 'zh-CN',
    status: 'valid',
    tier: 'public_dev',
    promptTemplate: '1+1=?',
    grader: 'exact_answer_line',
    graderVersion: 'exact_answer_v2',
    scoring: { type: 'exact_answer_line' },
    requirements: { answer: 2 } as unknown as string[],
    scenarioVersion: '1.0.0',
    scenarioHash: 'a'.repeat(16),
    ...overrides,
  };
}

describe('validateScenario', () => {
  it('valid scenario passes with no errors', () => {
    const report = validateScenario(baseScenario());
    expect(report.errors).toHaveLength(0);
    expect(report.eligible).toBe(true);
  });

  it('unknown field → warning (loose), error (strict)', () => {
    const s = baseScenario({ requirements: { answer: 2, bogusField: 1 } as unknown as string[] });
    const loose = validateScenario(s);
    expect(loose.warnings.some((w) => w.code === 'UNKNOWN_FIELD')).toBe(true);
    const strict = validateScenario(s, { strict: true });
    expect(strict.errors.some((e) => e.code === 'UNKNOWN_FIELD')).toBe(true);
  });

  it('missing required field → error', () => {
    const s = baseScenario({ requirements: {} as unknown as string[] });
    const report = validateScenario(s);
    expect(report.errors.some((e) => e.code === 'MISSING_REQUIRED')).toBe(true);
  });

  it('unregistered grader → error', () => {
    const s = baseScenario({ grader: 'does_not_exist' });
    const report = validateScenario(s);
    expect(report.errors.some((e) => e.code === 'UNREGISTERED_GRADER')).toBe(true);
  });

  it('unsupported format → error', () => {
    const s = baseScenario({
      dimension: 'structured_output',
      grader: 'schema_compliance',
      graderVersion: 'schema_compliance_v2',
      scoring: { type: 'schema_compliance' },
      requirements: { format: 'ics' } as unknown as string[],
    });
    const report = validateScenario(s);
    expect(report.errors.some((e) => e.code === 'UNSUPPORTED_FORMAT')).toBe(true);
  });

  it('empty hash → error', () => {
    const s = baseScenario({ scenarioHash: '' });
    const report = validateScenario(s);
    expect(report.errors.some((e) => e.code === 'EMPTY_HASH')).toBe(true);
  });

  it('grader alias resolves (code_repair_v3 → code_repair)', () => {
    expect(getGraderContract('code_repair_v3')?.grader).toBe('code_repair');
  });
});

describe('canonicalizeScenario / hashScenario', () => {
  it('field order does not affect hash', () => {
    const a = baseScenario();
    const b = baseScenario();
    expect(hashScenario(a)).toBe(hashScenario(b));
    expect(hashScenarioShort(a)).toHaveLength(16);
  });

  it('content change changes hash', () => {
    const a = baseScenario();
    const b = baseScenario({ requirements: { answer: 3 } as unknown as string[] });
    expect(hashScenario(a)).not.toBe(hashScenario(b));
  });

  it('canonicalize sorts object keys (stable JSON)', () => {
    const s = baseScenario();
    const canon = canonicalizeScenario(s);
    expect(canon).toBe(canonicalizeScenario(baseScenario()));
  });

  it('normalizes a verified-at instant across SQLite date round-trips', () => {
    const source = baseScenario({ goldVerifiedAt: '2026-09-12T00:00:00.000+08:00' });
    const roundTripped = baseScenario({ goldVerifiedAt: '2026-09-11T16:00:00.000Z' });
    expect(hashScenarioShort(source)).toBe(hashScenarioShort(roundTripped));
  });
});

describe('checkScenarioEligibility', () => {
  it('a frozen public benchmark item can enter a formal run', () => {
    const s = baseScenario();
    s.scenarioHash = hashScenarioShort(s);
    const r = checkScenarioEligibility(s);
    expect(r.eligible).toBe(true);
  });

  it('keeps development-shadow tasks outside formal scores', () => {
    const s = baseScenario({ requirements: { answer: 2, developmentShadow: true } as unknown as string[] });
    s.scenarioHash = hashScenarioShort(s);
    const r = checkScenarioEligibility(s);
    expect(r.eligible).toBe(false);
    expect(r.reasons.join('\n')).toContain('影子题');
  });
});
