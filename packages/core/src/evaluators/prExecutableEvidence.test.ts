import { describe, expect, it, vi } from 'vitest';
import { PR_SHARDING_REFERENCE, evaluatePrShardingWitness, parsePrShardingSubmission } from '../evaluationLab/prWitnessSharding.js';

describe('PR sharding executable evidence', () => {
  const reference = JSON.stringify(PR_SHARDING_REFERENCE);
  it('accepts the replayable witness and complete migration patch without a Judge', () => {
    const r = evaluatePrShardingWitness(reference, 'fixed-seed');
    expect(r.accepted).toBe(true);
    expect(r.modelApiCalls).toBe(0);
    expect(r.checks.every(c => c.passed)).toBe(true);
  });
  it('rejects prose, extra fields, weak workloads, unsafe rollback, and rejecting cross-bucket transactions', () => {
    expect(parsePrShardingSubmission('建议灰度发布')).toBeNull();
    const base = JSON.parse(reference);
    expect(parsePrShardingSubmission(JSON.stringify({ ...base, score: 100 }))).toBeNull();
    const weak = structuredClone(base); weak.witness.hotspot.hotEntityIds = ['one'];
    expect(parsePrShardingSubmission(JSON.stringify(weak))).toBeNull();
    const rollback = structuredClone(base); rollback.patch.migration.reverseSyncBeforeRollback = false;
    expect(parsePrShardingSubmission(JSON.stringify(rollback))).toBeNull();
    const reject = structuredClone(base); reject.patch.routing.crossBucketTransactions = 'reject';
    const r = evaluatePrShardingWitness(JSON.stringify(reject), 'fixed-seed');
    expect(r.accepted).toBe(false);
    expect(r.checks.find(c => c.id === 'cross-bucket-behavior-explicit')?.passed).toBe(false);
  });
  it('does not accept duplicate or fabricated hotspot structure', () => {
    const duplicate = structuredClone(PR_SHARDING_REFERENCE) as any;
    duplicate.witness.hotspot.hotEntityIds = Array(8).fill('same');
    const r = evaluatePrShardingWitness(JSON.stringify(duplicate), 'fixed-seed');
    expect(r.accepted).toBe(false);
    expect(r.checks.find(c => c.id === 'original-tenant-key-hotspot')?.passed).toBe(false);
  });
});
