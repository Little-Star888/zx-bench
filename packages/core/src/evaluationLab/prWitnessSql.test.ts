import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInContainer, type ContainerRunOptions } from '../execution/containerRunner.js';
import {
  PR_SQL_SOURCE, PR_SQL_ROWS, PR_SQL_REFERENCE, PR_SQL_REGRESSIONS, PR_SQL_DRIVER, PR_SQL_DEVELOPMENT_CONTROLS, PR_SQL_IMAGE,
  PR_SQLITE_VERSION, PR_SQL_DEVELOPMENT_TASK, createPrSqlWorlds, prSqlWorldRegressions,
  parsePrSqlSubmission, prSqlContainerOptions, decodePrSqlObservation, expectedPrSqlRows,
  matchesPrSqlName, observePrSql, evaluatePrSqlWitness,
} from './prWitnessSql.js';

vi.mock('../execution/containerRunner.js', async original => ({ ...await original<object>(), runInContainer: vi.fn() }));
const result = (data: unknown) => ({ success: true, stdout: JSON.stringify(data), stderr: '', exitCode: 0, timedOut: false, durationMs: 1 });
const queryResult = (rows: unknown[], columns = ['id', 'login', 'role']) => result({ protocol: 'pr-witness-sql-v1', status: 'ok', sqliteVersion: PR_SQLITE_VERSION, columns, rows });
const request = (o: ContainerRunOptions) => JSON.parse(o.files!.find(f => f.path === 'input.json')!.content);
const correct = PR_SQL_DEVELOPMENT_CONTROLS[0].output;
const deterministicWorlds = { worldFactory: () => createPrSqlWorlds('fixed-unit-test-seed') };
const mockCorrectWorld = async (o: ContainerRunOptions) => {
  const input = request(o);
  if (!input.parameters.length) return queryResult(input.databaseRows.map((r: { id: number; login: string; role: string }) => [r.id, r.login, r.role]));
  return queryResult(expectedPrSqlRows(input.parameters[0], input.databaseRows));
};
beforeEach(() => { vi.mocked(runInContainer).mockReset(); });

it('binds the production task to the migrated executable scenario', () => {
  const bank = JSON.parse(readFileSync('data/scenarios/benchmark.json', 'utf8'));
  const scenario = bank.find((s: { id: string }) => s.id === PR_SQL_SOURCE.scenarioId);
  expect(scenario.promptTemplate).toContain(PR_SQL_SOURCE.file);
  expect(scenario.promptTemplate).toContain(PR_SQL_SOURCE.addedLine.trim());
  expect(scenario.requirements.protocol).toBe('pr-witness-sql-v1');
  expect(scenario.grader).toBe('pr_executable_evidence');
  expect(scenario.graderVersion).toBe('1.0.0');
  expect(PR_SQL_DEVELOPMENT_TASK.status).toBe('production');
  expect(PR_SQL_DEVELOPMENT_TASK.referenceFlag.independentHumanReviewed).toBe(false);
  expect(PR_SQL_DEVELOPMENT_TASK.environment.sqliteVersion).toBe(PR_SQLITE_VERSION);
  expect(JSON.stringify(PR_SQL_DEVELOPMENT_TASK)).not.toContain(PR_SQL_REFERENCE.sql);
  expect(JSON.stringify(PR_SQL_DEVELOPMENT_TASK)).not.toContain('alternate-injection');
});

it('creates two reproducible worlds with changed IDs/roles and a fresh legitimate login', () => {
  const worlds = createPrSqlWorlds('seed-a');
  expect(worlds).toEqual(createPrSqlWorlds('seed-a'));
  expect(worlds[1].fixtureHash).not.toBe(createPrSqlWorlds('seed-b')[1].fixtureHash);
  expect(worlds[1].rows).toHaveLength(worlds[0].rows.length + 3);
  for (const [index, row] of worlds[0].rows.entries()) {
    expect(worlds[1].rows[index].login).toBe(row.login);
    expect(worlds[1].rows[index].id).not.toBe(row.id);
    expect(worlds[1].rows[index].role).not.toBe(row.role);
  }
  expect(worlds[1].rows.some(row => row.login.length === 0)).toBe(true);
  expect(worlds[1].rows.some(row => row.login.length === 2048)).toBe(true);
  for (const world of worlds) for (const row of world.rows)
    expect(prSqlWorldRegressions(world).some(test => test.name === row.login)).toBe(true);
});

it('requires exactly one real bound-name selector and accepts no Python/TS payload field', () => {
  expect(parsePrSqlSubmission(correct)?.patch).toEqual(PR_SQL_REFERENCE);
  const base = JSON.parse(correct);
  for (const value of [
    { ...base, score: 100 }, { ...base, witness: { name: 42 } },
    { ...base, witness: { name: 'a\0b' } }, { ...base, witness: { name: 'x'.repeat(2049) } },
    { ...base, patch: { ...base.patch, python: 'print(100)' } },
    { ...base, patch: { ...base.patch, bindings: [] } },
    { ...base, patch: { ...base.patch, bindings: ['name', 'name'] } },
    { ...base, patch: { ...base.patch, bindings: ['other'] } },
    { ...base, patch: { ...base.patch, sql: '' } },
  ]) expect(parsePrSqlSubmission(JSON.stringify(value))).toBeNull();
  expect(parsePrSqlSubmission('```json\n' + correct + '\n```')).toBeNull();
  expect(PR_SQL_DEVELOPMENT_CONTROLS.every(c => c.id === 'params-not-bound' || parsePrSqlSubmission(c.output))).toBe(true);
});

it('gives the static Python driver only current SQL/parameters/database, never expected answers or all tests', () => {
  const hostile = "'); __import__('os').system('echo forged'); #";
  const o = prSqlContainerOptions(PR_SQL_REFERENCE.sql, [hostile]);
  expect(o).toMatchObject({ localImageOnly: true, readOnlyRoot: true, readOnly: true, networkDisabled: true, runAsNonRoot: true, maxOutputBytes: 65536, timeoutMs: 4000 });
  expect(o.image).toBe(PR_SQL_IMAGE);
  expect(o.files?.map(f => f.path)).toEqual(['driver.py', 'input.json']);
  expect(o.files?.[0].content).toBe(PR_SQL_DRIVER);
  expect(o.files?.[0].content).not.toContain(hostile);
  expect(Object.keys(request(o))).toEqual(['sql', 'parameters', 'databaseRows']);
  expect(request(o).parameters).toEqual([hostile]);
  for (const test of PR_SQL_REGRESSIONS) expect(o.files?.[1].content).not.toContain(test.id);
  expect(PR_SQL_DRIVER).toContain('mode=ro');
  expect(PR_SQL_DRIVER).toContain('db.set_authorizer(authorize)');
  expect(PR_SQL_DRIVER).toContain('db.set_progress_handler(progress, 100)');
});

it('checks actual typed rows, duplicates and columns; candidate success messages do not count', () => {
  const decode = (rows: unknown[], columns?: string[]) => decodePrSqlObservation(queryResult(rows, columns), '?');
  expect(matchesPrSqlName(decode(expectedPrSqlRows('alice')), 'alice')).toBe(true);
  for (const rows of [[], [[2, 'bob', 'admin']], [[1, 'alice', 'member'], [1, 'alice', 'member']], [['1', 'alice', 'member']]])
    expect(matchesPrSqlName(decode(rows), 'alice')).toBe(false);
  expect(matchesPrSqlName(decode(expectedPrSqlRows('alice'), ['id', 'role', 'login']), 'alice')).toBe(false);
  for (const payload of [{ passed: true, score: 100 }, { protocol: 'pr-witness-sql-v1', status: 'ok', sqliteVersion: PR_SQLITE_VERSION, columns: [], rows: [], score: 100 }])
    expect(decodePrSqlObservation(result(payload), '?').status).toBe('invalid_observation');
  const success = queryResult(expectedPrSqlRows('alice'));
  for (const failure of [{ success: false }, { timedOut: true }, { outputLimitExceeded: true }])
    expect(decodePrSqlObservation({ ...success, ...failure }, '?').status).toBe('execution_failure');
});

it('returns source-bound step evidence and keeps all unrelated review dimensions explicitly unmeasured', async () => {
  vi.mocked(runInContainer).mockImplementation(mockCorrectWorld);
  const r = await evaluatePrSqlWitness(correct, deterministicWorlds);
  expect(r.accepted).toBe(true);
  expect(r.status).toBe('verified_development_controls');
  expect(r.independentHumanGold).toBe(false);
  expect(r.registered).toBe(true);
  expect(r.modelApiCalls).toBe(0);
  expect(r.unmeasured).toContain('logging');
  const checks = 4 + deterministicWorlds.worldFactory().reduce((n, w) => n + 1 + prSqlWorldRegressions(w).length, 0);
  expect(r.evidence).toHaveLength(checks);
  expect(r.evidence[0].unauthorizedRowIds).toEqual([1, 2, 3, 4, 5, 7]);
  expect(r.evidence[1].passed).toBe(true);
  expect(r.evidence.slice(2).every(e => e.passed)).toBe(true);
  expect(r.evidence.filter(e => e.phase === 'original_witness')).toHaveLength(2);
  expect(r.evidence.every(e => e.worldId && e.fixtureHash)).toBe(true);
  expect('submission' in r && r.submission).toEqual(JSON.parse(correct));
  expect(runInContainer).toHaveBeenCalledTimes(checks);
});

it('does not accept a non-demonstrating witness or a failed reference control', async () => {
  vi.mocked(runInContainer).mockImplementation(async o => queryResult(expectedPrSqlRows(request(o).parameters[0] ?? 'alice', request(o).databaseRows)));
  const innocent = JSON.parse(correct); innocent.witness.name = 'alice';
  expect((await evaluatePrSqlWitness(JSON.stringify(innocent))).status).toBe('witness_not_demonstrated');
  expect(runInContainer).toHaveBeenCalledTimes(2);
  vi.mocked(runInContainer).mockReset().mockResolvedValue(queryResult([]));
  expect((await evaluatePrSqlWitness(correct)).status).toBe('reference_control_invalid');
  expect(runInContainer).toHaveBeenCalledTimes(2);
});

it('does not confuse SQL-fabricated rows or forged real IDs with disclosure of a real fixture row', async () => {
  for (const row of [[999, 'fabricated', 'admin'], [2, 'fabricated', 'admin']]) {
    vi.mocked(runInContainer).mockReset().mockImplementation(async o => request(o).parameters.length
      ? queryResult(expectedPrSqlRows(request(o).parameters[0])) : queryResult([row]));
    const r = await evaluatePrSqlWitness(correct);
    expect(r.status).toBe('witness_not_demonstrated');
    expect(r.evidence[0].unauthorizedRowIds).toEqual([]);
  }
});

it('a fully rejecting patch cannot earn repair credit by blocking the witness', async () => {
  let calls = 0;
  vi.mocked(runInContainer).mockImplementation(async o => ++calls <= 4 ? mockCorrectWorld(o) : queryResult([]));
  const r = await evaluatePrSqlWitness(PR_SQL_DEVELOPMENT_CONTROLS.find(c => c.id === 'reject-every-request')!.output);
  expect(r.status).toBe('candidate_patch_failed');
  expect(r.accepted).toBe(false);
  expect(r.evidence.find(e => e.id === 'normal-member')?.passed).toBe(false);
  expect(r.evidence.find(e => e.id === 'not-found')?.passed).toBe(true);
});

it('a missing counterfactual cannot silently reduce the verification contract', async () => {
  const r = await evaluatePrSqlWitness(correct, { worldFactory: () => [] });
  expect(r.status).toBe('world_configuration_invalid');
  expect(runInContainer).not.toHaveBeenCalled();
});

it('missing bindings is a contract failure without starting a container', async () => {
  const r = await evaluatePrSqlWitness(PR_SQL_DEVELOPMENT_CONTROLS.find(c => c.id === 'params-not-bound')!.output);
  expect(r.status).toBe('invalid_submission');
  expect(r.accepted).toBe(false);
  expect(runInContainer).not.toHaveBeenCalled();
});

it('stops on independently observed infrastructure failure and distrusts text claiming infrastructure failure', async () => {
  vi.mocked(runInContainer).mockResolvedValue({ success: false, stdout: '', stderr: '', exitCode: -1, durationMs: 1, timedOut: false, infrastructureError: 'image unavailable' });
  expect((await evaluatePrSqlWitness(correct)).status).toBe('infrastructure_unavailable');
  expect(runInContainer).toHaveBeenCalledTimes(1);
  expect(decodePrSqlObservation(result({ infrastructureError: 'image unavailable' }), '?').status).toBe('invalid_observation');
});

it('keeps trusted runtime drift unmeasured even if it first occurs during candidate checks', async () => {
  let calls = 0;
  vi.mocked(runInContainer).mockImplementation(async o => ++calls <= 4 ? mockCorrectWorld(o)
    : result({ protocol: 'pr-witness-sql-v1', status: 'ok', sqliteVersion: '0.0.0', columns: ['id', 'login', 'role'], rows: [] }));
  const r = await evaluatePrSqlWitness(correct, deterministicWorlds);
  expect(r.status).toBe('infrastructure_unavailable');
  const firstCandidate = r.evidence.find(e => e.phase === 'candidate_witness');
  expect(firstCandidate?.observation.infrastructureError).toContain('SQLite runtime mismatch');
  // Candidate cases start in a bounded group of four; all observations in the
  // already-started group are retained before infrastructure failure returns.
  expect(runInContainer).toHaveBeenCalledTimes(8);
});

it('a candidate SELECT with invalid row types is not mislabeled as infrastructure failure', async () => {
  let calls = 0;
  vi.mocked(runInContainer).mockImplementation(async o => ++calls <= 4 ? mockCorrectWorld(o) : queryResult([[null, 'alice', 'member']]));
  const r = await evaluatePrSqlWitness(correct, deterministicWorlds);
  expect(r.status).toBe('candidate_patch_failed');
  expect(r.evidence.slice(4).every(e => e.observation.status === 'invalid_observation')).toBe(true);
});

describe.skipIf(process.env.ZXBENCH_PR_WITNESS_CONTAINERS !== '1')('opt-in: actual SQLite in disposable hardened containers, bounded concurrency', () => {
  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('../execution/containerRunner.js')>('../execution/containerRunner.js');
    vi.mocked(runInContainer).mockImplementation(actual.runInContainer);
  });
  it('proves the injection and correct SQL template repair with all development regressions', async () => {
    const r = await evaluatePrSqlWitness(correct);
    expect(r.accepted, JSON.stringify(r)).toBe(true);
    expect(r.evidence.every(e => e.observation.sqliteVersion)).toBe(true);
  }, 180000);
  it('rejects a UNION of invented rows as a disclosure witness', async () => {
    const s = JSON.parse(correct);
    s.witness.name = "missing' UNION SELECT 999,'fabricated','admin' --";
    const r = await evaluatePrSqlWitness(JSON.stringify(s));
    expect(r.status, JSON.stringify(r)).toBe('witness_not_demonstrated');
    expect(r.evidence[0].observation.rows).toEqual([[999, 'fabricated', 'admin']]);
    expect(r.evidence[0].unauthorizedRowIds).toEqual([]);
  }, 30000);
  it('rejects a constant UNION copying a real public row when the counterfactual database changes', async () => {
    const s = JSON.parse(correct);
    s.witness.name = "missing' UNION SELECT 2,'bob','admin' --";
    const r = await evaluatePrSqlWitness(JSON.stringify(s), deterministicWorlds);
    expect(r.status, JSON.stringify(r)).toBe('witness_not_demonstrated');
    const witnesses = r.evidence.filter(e => e.phase === 'original_witness');
    expect(witnesses.map(e => e.passed)).toEqual([true, false]);
    expect(witnesses[1].unauthorizedRowIds).toEqual([]);
  }, 30000);
  it('rejects a patch hardcoded to the original table after verifying its original-world compatibility', async () => {
    const c = PR_SQL_DEVELOPMENT_CONTROLS.find(c => c.id === 'hardcoded-original-table-ids')!;
    const r = await evaluatePrSqlWitness(c.output, deterministicWorlds);
    expect(r.status, JSON.stringify(r)).toBe('candidate_patch_failed');
    expect(r.evidence.filter(e => e.worldId === 'original-fixture').every(e => e.passed)).toBe(true);
    const changed = r.evidence.filter(e => e.worldId === 'counterfactual-fixture' && e.phase.startsWith('candidate'));
    expect(changed).toHaveLength(1 + prSqlWorldRegressions(deterministicWorlds.worldFactory()[1]).length);
    expect(changed.find(e => e.id === 'candidate-same-witness')?.passed).toBe(false);
    expect(changed.find(e => e.id === 'counterfactual-new-valid-login')?.passed).toBe(false);
    expect(changed.find(e => e.id === 'not-found')?.passed).toBe(true);
  }, 180000);
  it('replays every regression in the changed world to reject a conditional copy of the original alice ID', async () => {
    const c = PR_SQL_DEVELOPMENT_CONTROLS.find(c => c.id === 'conditional-alice-id-copy')!;
    const r = await evaluatePrSqlWitness(c.output, deterministicWorlds);
    expect(r.status, JSON.stringify(r)).toBe('candidate_patch_failed');
    expect(r.evidence.filter(e => e.worldId === 'original-fixture').every(e => e.passed)).toBe(true);
    const failures = r.evidence.filter(e => !e.passed);
    expect(failures.map(e => [e.worldId, e.id])).toEqual([['counterfactual-fixture', 'normal-member']]);
  }, 180000);
  it('rejects a conditional copy of the original alice role against the changed world', async () => {
    const c = PR_SQL_DEVELOPMENT_CONTROLS.find(c => c.id === 'conditional-alice-role-copy')!;
    const s = parsePrSqlSubmission(c.output)!;
    const world = deterministicWorlds.worldFactory()[1];
    const observed = await observePrSql(s.patch.sql, ['alice'], world.rows);
    expect(observed.infrastructureError, JSON.stringify(observed)).toBeUndefined();
    expect(matchesPrSqlName(observed, 'alice', world.rows)).toBe(false);
  }, 30000);
  it('rejects a 200-character ceiling while preserving the declared 2048-character boundary', async () => {
    const c = PR_SQL_DEVELOPMENT_CONTROLS.find(c => c.id === 'length-limit-200')!;
    const s = parsePrSqlSubmission(c.output)!;
    const world = deterministicWorlds.worldFactory()[1];
    const boundary = world.rows.find(row => row.login.length === 2048)!;
    const observed = await observePrSql(s.patch.sql, [boundary.login], world.rows);
    expect(observed.infrastructureError, JSON.stringify(observed)).toBeUndefined();
    expect(matchesPrSqlName(observed, boundary.login, world.rows)).toBe(false);
  }, 30000);
  it.each(PR_SQL_DEVELOPMENT_CONTROLS.filter(c => !c.accepted && !['params-not-bound', 'hardcoded-original-table-ids', 'conditional-alice-id-copy', 'conditional-alice-role-copy', 'length-limit-200'].includes(c.id)))('rejects semantic control $id using actual query rows or SQLite errors', async c => {
    const s = parsePrSqlSubmission(c.output)!;
    const name = c.id === 'length-limit-rejects-valid-name' ? PR_SQL_ROWS[4].login : 'alice';
    const observed = await observePrSql(s.patch.sql, [name]);
    expect(observed.infrastructureError, JSON.stringify(observed)).toBeUndefined();
    expect(matchesPrSqlName(observed, name), JSON.stringify(observed)).toBe(false);
  }, 30000);
  it.each([
    'DELETE FROM users WHERE login = ?',
    'PRAGMA user_version',
    "ATTACH DATABASE '/tmp/other.sqlite' AS extra",
    'SELECT * FROM sqlite_master WHERE name = ?',
    'SELECT * FROM users WHERE login = ?; SELECT * FROM users',
    "SELECT load_extension(?)",
    'SELECT a.id, a.login, a.role FROM users a CROSS JOIN users b WHERE a.login = ?1 OR ?1 IS NOT NULL',
  ])('blocks out-of-contract SQL without giving SQL access to the observer: %s', async sql => {
    const observed = await observePrSql(sql, sql.includes('?') ? ['alice'] : []);
    expect(observed.infrastructureError, JSON.stringify(observed)).toBeUndefined();
    expect(observed.status, JSON.stringify(observed)).toBe('query_error');
  }, 30000);
  it('interrupts a bounded read-only Cartesian search via the SQLite VM progress limit', async () => {
    const sql = 'SELECT a.id, a.login, a.role FROM users a CROSS JOIN users b CROSS JOIN users c CROSS JOIN users d CROSS JOIN users e CROSS JOIN users f CROSS JOIN users g CROSS JOIN users h WHERE a.login = ? AND length(b.login)+length(c.login)+length(d.login)+length(e.login)+length(f.login)+length(g.login)+length(h.login)<0';
    const observed = await observePrSql(sql, ['alice']);
    expect(observed.status, JSON.stringify(observed)).toBe('query_error');
    expect(observed.errorMessage).toContain('interrupted');
    expect(observed.timedOut).toBe(false);
  }, 30000);
});
