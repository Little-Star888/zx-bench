import type { EvalConstraints, ModelParams } from '@zxbench/types';

/** A loop shares one task budget across all calls, just like single-call tasks. */
export function executionTimeoutMs(hardSeconds: unknown, constraints: EvalConstraints, params: ModelParams): number {
  const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
  const seconds = Number(hardSeconds);
  const caps = [positive(seconds) ? seconds * 1000 : undefined, constraints.hardTimeLimitMs].filter(positive);
  return caps.length ? Math.min(...caps) : positive(params.hardTimeoutMs) ? params.hardTimeoutMs
    : positive(params.timeout) ? params.timeout : 600_000;
}
