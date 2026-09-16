import path from 'node:path';
import { describe, expect, it } from 'vitest';
// The production importer is plain Node ESM so users can run it without a TS loader.
// @ts-expect-error no declaration file is needed for this local script module
import { loadBenchmarkImportScope } from '../../../scripts/benchmark-import-scope.mjs';

describe('released benchmark import scope', () => {
  it('imports only the canonical bank and identifies accidental bundled history', () => {
    const scope = loadBenchmarkImportScope(path.resolve('data/scenarios'));
    expect(scope.scenarios).toHaveLength(796);
    expect(scope.scenarios.filter((scenario: any) => scenario.dimension === 'program')).toHaveLength(150);
    expect([...scope.accidentalBundledIds].length).toBeGreaterThan(0);
    expect([...scope.accidentalBundledIds].some((id) => String(id).startsWith('CR2-'))).toBe(true);
    expect([...scope.accidentalBundledIds].some((id) => scope.benchmarkIds.has(id))).toBe(false);
  });
});
