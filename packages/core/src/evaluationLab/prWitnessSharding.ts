import { createHash, randomBytes } from 'node:crypto';

export const PR_SHARDING_TASK = {
  id: 'PR-ELITE-013',
  protocol: 'pr-witness-sharding-v1',
  version: '1.0.0',
} as const;

type Submission = {
  protocol: 'pr-witness-sharding-v1';
  witness: {
    rollback: { beforeCutover: string[]; afterCutover: string[] };
    hotspot: { hotTenant: string; hotEntityIds: string[]; otherTenants: string[] };
  };
  patch: {
    routing: { key: 'tenant_id_plus_entity_id'; virtualBuckets: number; crossBucketTransactions: 'saga' | 'reject' };
    migration: {
      durableDualWrite: true; backfillBeforeRead: true; reconcileBeforeRead: true;
      perTenantCanary: true; killSwitch: true; reverseSyncBeforeRollback: true;
    };
  };
};

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const strings = (v: unknown, min: number, max: number): v is string[] => Array.isArray(v) && v.length >= min && v.length <= max
  && v.every(x => typeof x === 'string' && x.length > 0 && x.length <= 128 && !x.includes('\0'));

export function parsePrShardingSubmission(output: string): Submission | null {
  if (Buffer.byteLength(output) > 32768) return null;
  try {
    const s = JSON.parse(output);
    if (!plain(s) || !exactKeys(s, ['protocol', 'witness', 'patch']) || s.protocol !== PR_SHARDING_TASK.protocol
      || !plain(s.witness) || !exactKeys(s.witness, ['rollback', 'hotspot'])
      || !plain(s.witness.rollback) || !exactKeys(s.witness.rollback, ['beforeCutover', 'afterCutover'])
      || !strings(s.witness.rollback.beforeCutover, 1, 32) || !strings(s.witness.rollback.afterCutover, 1, 32)
      || !plain(s.witness.hotspot) || !exactKeys(s.witness.hotspot, ['hotTenant', 'hotEntityIds', 'otherTenants'])
      || typeof s.witness.hotspot.hotTenant !== 'string' || !s.witness.hotspot.hotTenant
      || !strings(s.witness.hotspot.hotEntityIds, 8, 64) || !strings(s.witness.hotspot.otherTenants, 2, 64)
      || !plain(s.patch) || !exactKeys(s.patch, ['routing', 'migration'])
      || !plain(s.patch.routing) || !exactKeys(s.patch.routing, ['key', 'virtualBuckets', 'crossBucketTransactions'])
      || s.patch.routing.key !== 'tenant_id_plus_entity_id'
      || !Number.isInteger(s.patch.routing.virtualBuckets) || Number(s.patch.routing.virtualBuckets) < 8 || Number(s.patch.routing.virtualBuckets) > 256
      || !['saga', 'reject'].includes(String(s.patch.routing.crossBucketTransactions))
      || !plain(s.patch.migration) || !exactKeys(s.patch.migration, ['durableDualWrite', 'backfillBeforeRead', 'reconcileBeforeRead', 'perTenantCanary', 'killSwitch', 'reverseSyncBeforeRollback'])
      || Object.values(s.patch.migration).some(v => v !== true)) return null;
    return s as Submission;
  } catch { return null; }
}

const hashInt = (s: string) => Number.parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16) >>> 0;
const unique = (xs: string[]) => new Set(xs).size === xs.length;

export interface PrShardingCheck { id: string; phase: 'witness' | 'regression'; passed: boolean; detail: string }

export function evaluatePrShardingWitness(output: string, seed = randomBytes(24).toString('hex')) {
  const submission = parsePrShardingSubmission(output);
  const checks: PrShardingCheck[] = [];
  if (!submission) return { status: 'invalid_submission', accepted: false, checks, seedHash: createHash('sha256').update(seed).digest('hex') };
  const { witness, patch } = submission;

  // Replay the PR's stated rollback failure: post-cutover writes exist only in the new store.
  const oldStore = new Set(witness.rollback.beforeCutover);
  const newStore = new Set([...witness.rollback.beforeCutover, ...witness.rollback.afterCutover]);
  const missingAfterRollback = [...newStore].filter(id => !oldStore.has(id));
  checks.push({ id: 'original-rollback-loses-new-writes', phase: 'witness', passed: missingAfterRollback.length > 0,
    detail: `${missingAfterRollback.length} post-cutover record(s) absent from old store` });

  // Replay the PR's tenant-only hash and require a concrete hot tenant workload.
  const entities = witness.hotspot.hotEntityIds;
  const validWorkload = unique(entities) && unique(witness.hotspot.otherTenants)
    && !witness.hotspot.otherTenants.includes(witness.hotspot.hotTenant);
  const oldBuckets = new Set(entities.map(() => hashInt(witness.hotspot.hotTenant) % 16));
  checks.push({ id: 'original-tenant-key-hotspot', phase: 'witness', passed: validWorkload && oldBuckets.size === 1,
    detail: `${entities.length} hot-tenant entities occupy ${oldBuckets.size} shard(s) under tenant-only routing` });

  // Counterfactual worlds make hard-coded public entity IDs insufficient.
  const generated = Array.from({ length: 48 }, (_, i) => `entity-${i}-${hashInt(seed + ':' + i).toString(16)}`);
  for (const [id, world] of [['submitted-workload', entities], ['counterfactual-workload', generated]] as const) {
    const buckets = new Set(world.map(entity => hashInt(`${witness.hotspot.hotTenant}\0${entity}`) % patch.routing.virtualBuckets));
    checks.push({ id: `${id}-hot-tenant-spreads`, phase: 'regression', passed: buckets.size >= Math.min(6, Math.floor(world.length / 2)),
      detail: `${world.length} entities occupy ${buckets.size} virtual bucket(s)` });
  }
  checks.push({ id: 'cross-bucket-behavior-explicit', phase: 'regression', passed: patch.routing.crossBucketTransactions === 'saga',
    detail: patch.routing.crossBucketTransactions });

  const migration = patch.migration;
  checks.push({ id: 'cutover-gated-by-backfill-and-reconciliation', phase: 'regression',
    passed: migration.durableDualWrite && migration.backfillBeforeRead && migration.reconcileBeforeRead,
    detail: 'durable dual write + backfill + reconciliation gate' });
  checks.push({ id: 'bounded-canary-and-immediate-stop', phase: 'regression',
    passed: migration.perTenantCanary && migration.killSwitch, detail: 'per-tenant canary + kill switch' });
  checks.push({ id: 'rollback-preserves-post-cutover-writes', phase: 'regression',
    passed: migration.durableDualWrite && migration.reverseSyncBeforeRollback,
    detail: 'old store is synchronized before reads roll back' });

  const accepted = checks.every(c => c.passed);
  return { status: accepted ? 'verified' : 'failed', accepted, checks,
    seedHash: createHash('sha256').update(seed).digest('hex'), modelApiCalls: 0 };
}

export const PR_SHARDING_REFERENCE: Submission = {
  protocol: 'pr-witness-sharding-v1',
  witness: {
    rollback: { beforeCutover: ['order-before'], afterCutover: ['order-after'] },
    hotspot: { hotTenant: 'tenant-enterprise', hotEntityIds: Array.from({ length: 16 }, (_, i) => `account-${i}`), otherTenants: ['tenant-a', 'tenant-b'] },
  },
  patch: {
    routing: { key: 'tenant_id_plus_entity_id', virtualBuckets: 64, crossBucketTransactions: 'saga' },
    migration: { durableDualWrite: true, backfillBeforeRead: true, reconcileBeforeRead: true, perTenantCanary: true, killSwitch: true, reverseSyncBeforeRollback: true },
  },
};
