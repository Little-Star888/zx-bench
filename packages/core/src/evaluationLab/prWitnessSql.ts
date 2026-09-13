/** Evidence-carrying SQL repair used by the registered PR executable grader.
 * The submission is SQL DATA plus one bound-name selector, not arbitrary TS or
 * Python. Free-form review quality, JWT, payments and logging remain unmeasured.
 * Development references are not independent human gold or a held-out bank. */
import { createHash, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { runInContainer, type ContainerRunOptions, type ContainerRunResult } from '../execution/containerRunner.js';

export const PR_SQL_SOURCE = {
  scenarioId: 'PR-ELITE-012',
  bankPath: 'data/scenarios/benchmark.json',
  file: 'src/db/admin_lookup.sql.jstemplate',
  addedLine: "  return db.query(`SELECT * FROM users WHERE login = '${name}'`);",
  originalParameterizedLine: '  return db.query("SELECT * FROM users WHERE login = $1", [name]);',
} as const;
export const PR_SQL_IMAGE = 'python@sha256:d09d15e60962ca365d1cd544a48773bac9d33f2fb1b00f2aa0deec78ade7dc31';
export const PR_SQLITE_VERSION = '3.53.2';
export const PR_SQL_DEVELOPMENT_TASK = {
  id: 'PR-WITNESS-SQL-001', version: '1.0.0', protocol: 'pr-witness-sql-v1', status: 'production',
  dimension: 'program', capability: 'PR可执行证据与SQL模板修复', graderRegistered: true,
  source: { scenarioId: PR_SQL_SOURCE.scenarioId, bankPath: PR_SQL_SOURCE.bankPath, file: PR_SQL_SOURCE.file, addedLine: PR_SQL_SOURCE.addedLine },
  environment: { image: PR_SQL_IMAGE, sqliteVersion: PR_SQLITE_VERSION, scope: '新建独立SQLite环境，不是原PR项目数据库或完整应用的重建。' },
  referenceFlag: { kind: 'developer_reference', independentHumanReviewed: false },
  allowedFunctions: ['length', 'lower', 'upper', 'substr', 'substring', 'replace', 'trim', 'ltrim', 'rtrim', 'coalesce', 'ifnull', 'abs', 'typeof'],
  promptTemplate: `本题是PR可执行证据的校准与回归原型，不是高难挑战题或完整自然语言PR评审。
请审查 src/db/admin_lookup.sql.jstemplate 中的改动：
${PR_SQL_SOURCE.addedLine}
原查询通过字符串插值构造SQL；请给出一个name输入，证明它会返回至少一条数据库中真实存在、且login不等于该name的用户记录。凭空拼造出来的记录不算泄露见证。
本题使用新建的SQLite ${PR_SQLITE_VERSION}环境，并不重建原项目的实际数据库或其他服务。表schema为：
CREATE TABLE users (id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE COLLATE BINARY, role TEXT NOT NULL);
契约：name为不含NUL、长度不超过2048的字符串。正确查询须按login区分大小写、按字面精确匹配，返回全部匹配行的id/login/role原值；不存在的login返回空集。不得擅自改成模糊匹配、丢弃合法名称或改写记录内容。
同一提交会在不同表数据上重放，包括不同id/role及新增的合法login；不得硬编码某一份表。可信执行器每次只绑定当前name一次。
修复产物仅为SQLite只读SQL模板及绑定配置，不是任意TypeScript/Python补丁；本题不评分自然语言解释、严重级别、日志/JWT/支付或架构评审。
允许单条SELECT读取users。允许函数：length、lower、upper、substr、substring、replace、trim、ltrim、rtrim、coalesce、ifnull、abs、typeof；禁止写操作、PRAGMA、ATTACH、读取schema、加载扩展或多条SQL。SQL受长度、结果行数与VM步数限制。
仅输出严格JSON，不要代码块或其他字段：{"protocol":"pr-witness-sql-v1","witness":{"name":"你构造的输入"},"patch":{"sql":"修复后的SQL模板","bindings":["name"]}}。`,
} as const;

export interface PrSqlSubmission {
  protocol: 'pr-witness-sql-v1';
  witness: { name: string };
  patch: { sql: string; bindings: ['name'] };
}
export interface PrSqlRow { id: number; login: string; role: string; }
export const PR_SQL_ROWS: readonly PrSqlRow[] = [
  { id: 1, login: 'alice', role: 'member' },
  { id: 2, login: 'bob', role: 'admin' },
  { id: 3, login: "O'Brien", role: 'member' },
  { id: 4, login: '张三🧪', role: 'member' },
  { id: 5, login: 'long-' + 'x'.repeat(125), role: 'member' },
  { id: 6, login: "' OR 1=1 --", role: 'member' },
  { id: 7, login: 'a%_b', role: 'member' },
];
export const PR_SQL_REFERENCE: PrSqlSubmission['patch'] = {
  sql: 'SELECT * FROM users WHERE login = ?', bindings: ['name'],
};
/** Not exposed as an entire list to any query container. Public development
 * regressions are not claimed to be secret, independently sampled holdouts. */
export const PR_SQL_REGRESSIONS = [
  { id: 'normal-member', name: 'alice' },
  { id: 'normal-admin', name: 'bob' },
  { id: 'not-found', name: 'missing-user' },
  { id: 'apostrophe', name: "O'Brien" },
  { id: 'unicode', name: '张三🧪' },
  { id: 'long-valid-name', name: PR_SQL_ROWS[4].login },
  { id: 'injection-is-literal-name', name: "' OR 1=1 --" },
  { id: 'alternate-injection', name: "' OR '1'='1" },
  { id: 'wildcards-are-literal', name: 'a%_b' },
  { id: 'wildcard-probe-is-not-a-name', name: '%' },
  { id: 'case-sensitive-no-match', name: 'ALICE' },
  { id: 'spaces-are-literal', name: ' alice ' },
];

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export interface PrSqlWorld {
  id: string;
  seed: string;
  fixtureHash: string;
  rows: PrSqlRow[];
  addedLogin?: string;
}
/** Fresh host randomness prevents a fixed UNION/copy of the public table from
 * proving database-dependent disclosure. The seed and complete world are kept
 * in host evidence for reproducibility; this is not a secret independent holdout. */
export function createPrSqlWorlds(seed = randomBytes(24).toString('hex')): PrSqlWorld[] {
  const original = PR_SQL_ROWS.map(row => ({ ...row }));
  const idBase = 1000 + Number.parseInt(hash(seed + ':ids').slice(0, 6), 16);
  const counterfactual = original.map((row, index) => ({ ...row, id: idBase + index,
    role: 'role-' + hash(seed + ':role:' + index).slice(0, 20) }));
  const addedLogin = 'new-account-' + hash(seed + ':new-login').slice(0, 24);
  counterfactual.push({ id: idBase + original.length, login: addedLogin, role: 'role-' + hash(seed + ':new-role').slice(0, 20) });
  counterfactual.push({ id: idBase + original.length + 1, login: '', role: 'role-' + hash(seed + ':empty-role').slice(0, 20) });
  const boundaryPrefix = 'boundary-' + hash(seed + ':boundary-login').slice(0, 24);
  counterfactual.push({ id: idBase + original.length + 2, login: boundaryPrefix + 'x'.repeat(2048 - boundaryPrefix.length), role: 'role-' + hash(seed + ':boundary-role').slice(0, 20) });
  return [
    { id: 'original-fixture', seed, rows: original, fixtureHash: hash(JSON.stringify(original)) },
    { id: 'counterfactual-fixture', seed, rows: counterfactual, addedLogin, fixtureHash: hash(JSON.stringify(counterfactual)) },
  ];
}
/** Every actually present account must remain queryable, even as future world
 * generators add boundary rows; no hand-maintained name list can omit it. */
export function prSqlWorldRegressions(world: PrSqlWorld) {
  const existing = new Set(PR_SQL_REGRESSIONS.map(test => test.name));
  return [...PR_SQL_REGRESSIONS, ...world.rows.filter(row => !existing.has(row.login)).map((row, index) => ({
    id: row.login === world.addedLogin ? 'counterfactual-new-valid-login' : `world-extra-valid-login-${index}`,
    name: row.login,
  }))];
}
function validWorlds(worlds: PrSqlWorld[]): boolean {
  return worlds.length === 2 && new Set(worlds.map(w => w.id)).size === 2
    && worlds.every(world => world.rows.length > 0 && world.rows.length <= 32
      && world.fixtureHash === hash(JSON.stringify(world.rows))
      && new Set(world.rows.map(r => r.id)).size === world.rows.length
      && new Set(world.rows.map(r => r.login)).size === world.rows.length
      && world.rows.every(r => Number.isSafeInteger(r.id) && typeof r.login === 'string' && typeof r.role === 'string'))
    && typeof worlds[1].addedLogin === 'string'
    && worlds[1].rows.some(row => row.login === worlds[1].addedLogin);
}
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keysAre = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));

export function parsePrSqlSubmission(output: string): PrSqlSubmission | null {
  if (Buffer.byteLength(output) > 16384) return null;
  try {
    const s = JSON.parse(output);
    if (!plain(s) || !keysAre(s, ['protocol', 'witness', 'patch']) || s.protocol !== 'pr-witness-sql-v1'
      || !plain(s.witness) || !keysAre(s.witness, ['name']) || typeof s.witness.name !== 'string'
      || s.witness.name.length > 2048 || s.witness.name.includes('\0')
      || !plain(s.patch) || !keysAre(s.patch, ['sql', 'bindings']) || typeof s.patch.sql !== 'string'
      || !s.patch.sql.trim() || s.patch.sql.length > 8192 || s.patch.sql.includes('\0')
      || !isDeepStrictEqual(s.patch.bindings, ['name'])) return null;
    return s as unknown as PrSqlSubmission;
  } catch { return null; }
}

/** Static trusted driver: candidate strings enter json.load and sqlite.execute
 * only. No eval/exec, Python source interpolation, extension loading, shell,
 * writes, PRAGMA, ATTACH, user-defined functions or candidate-owned reporting. */
export const PR_SQL_DRIVER = `import json, sqlite3, time
PROTOCOL = 'pr-witness-sql-v1'
with open('input.json', encoding='utf-8') as f:
    request = json.load(f)
database = '/tmp/pr-witness.sqlite'
setup = sqlite3.connect(database)
setup.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE COLLATE BINARY, role TEXT NOT NULL)')
setup.executemany('INSERT INTO users(id, login, role) VALUES (?, ?, ?)', [(r['id'], r['login'], r['role']) for r in request['databaseRows']])
setup.commit()
setup.close()
db = sqlite3.connect('file:' + database + '?mode=ro', uri=True)
db.enable_load_extension(False)
db.execute('PRAGMA query_only=ON')
db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 16384)
db.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 8192)
db.setlimit(sqlite3.SQLITE_LIMIT_COLUMN, 8)
db.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH, 50)
db.setlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT, 4)
db.setlimit(sqlite3.SQLITE_LIMIT_VDBE_OP, 50000)
db.setlimit(sqlite3.SQLITE_LIMIT_ATTACHED, 0)
db.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 8)
allowed_functions = {'length', 'lower', 'upper', 'substr', 'substring', 'replace', 'trim', 'ltrim', 'rtrim', 'coalesce', 'ifnull', 'abs', 'typeof'}
def authorize(action, arg1, arg2, database_name, trigger):
    if action == sqlite3.SQLITE_SELECT:
        return sqlite3.SQLITE_OK
    if action == sqlite3.SQLITE_READ and database_name == 'main' and arg1 == 'users' and arg2 in ('id', 'login', 'role', ''):
        return sqlite3.SQLITE_OK
    if action == sqlite3.SQLITE_FUNCTION and str(arg2).lower() in allowed_functions:
        return sqlite3.SQLITE_OK
    return sqlite3.SQLITE_DENY
db.set_authorizer(authorize)
deadline = time.monotonic() + 0.5
ticks = 0
def progress():
    global ticks
    ticks += 1
    return int(ticks > 1000 or time.monotonic() >= deadline)
db.set_progress_handler(progress, 100)
try:
    cursor = db.execute(request['sql'], request['parameters'])
    columns = [column[0] for column in cursor.description] if cursor.description else []
    rows = cursor.fetchmany(33)
    if len(rows) > 32:
        raise ValueError('query_row_limit')
    output = {'protocol': PROTOCOL, 'status': 'ok', 'sqliteVersion': sqlite3.sqlite_version, 'columns': columns, 'rows': rows}
    encoded = json.dumps(output, ensure_ascii=False, allow_nan=False)
except (sqlite3.Error, ValueError, TypeError, MemoryError, OverflowError) as error:
    encoded = json.dumps({'protocol': PROTOCOL, 'status': 'query_error', 'sqliteVersion': sqlite3.sqlite_version, 'errorName': type(error).__name__, 'errorMessage': str(error)[:256]}, ensure_ascii=False)
finally:
    db.close()
print(encoded)
`;

export function prSqlContainerOptions(sql: string, parameters: string[], databaseRows: readonly PrSqlRow[] = PR_SQL_ROWS): ContainerRunOptions {
  if (typeof sql !== 'string' || sql.length > 8192 || !Array.isArray(parameters)
    || parameters.length > 1 || parameters.some(p => typeof p !== 'string' || p.length > 2048)) throw Error('Invalid SQL execution request');
  return {
    image: PR_SQL_IMAGE, command: ['python', '-I', '-B', 'driver.py'],
    files: [{ path: 'driver.py', content: PR_SQL_DRIVER },
      { path: 'input.json', content: JSON.stringify({ sql, parameters, databaseRows }) }],
    localImageOnly: true, readOnlyRoot: true, readOnly: true, networkDisabled: true, runAsNonRoot: true,
    timeoutMs: 4000, memoryMb: 128, cpuLimit: 1, pidsLimit: 32, maxOutputBytes: 65536,
  };
}

export interface PrSqlObservation {
  status: 'ok' | 'query_error' | 'invalid_observation' | 'execution_failure' | 'infrastructure_error';
  queryHash: string;
  columns?: string[];
  rows?: (number | string)[][];
  sqliteVersion?: string;
  errorName?: string;
  errorMessage?: string;
  infrastructureError?: string;
  durationMs: number;
  timedOut: boolean;
}

export function decodePrSqlObservation(result: ContainerRunResult, sql: string): PrSqlObservation {
  const base = { queryHash: hash(sql), durationMs: result.durationMs, timedOut: result.timedOut };
  if (result.infrastructureError) return { ...base, status: 'infrastructure_error', infrastructureError: result.infrastructureError };
  if (!result.success || result.timedOut || result.outputLimitExceeded) return { ...base, status: 'execution_failure' };
  try {
    const r = JSON.parse(result.stdout);
    // This field belongs to the fixed Python observer, never to candidate SQL.
    // A pinned-runtime mismatch is unmeasured infrastructure, not patch failure.
    if (plain(r) && r.protocol === 'pr-witness-sql-v1' && typeof r.sqliteVersion === 'string' && r.sqliteVersion !== PR_SQLITE_VERSION)
      return { ...base, status: 'infrastructure_error', infrastructureError: `SQLite runtime mismatch: expected ${PR_SQLITE_VERSION}, observed ${r.sqliteVersion}` };
    if (!plain(r) || r.protocol !== 'pr-witness-sql-v1' || r.sqliteVersion !== PR_SQLITE_VERSION) throw Error('Invalid observation');
    if (r.status === 'query_error' && keysAre(r, ['protocol', 'status', 'sqliteVersion', 'errorName', 'errorMessage'])
      && typeof r.errorName === 'string' && typeof r.errorMessage === 'string') return { ...base, status: 'query_error', sqliteVersion: r.sqliteVersion, errorName: r.errorName, errorMessage: r.errorMessage };
    if (r.status !== 'ok' || !keysAre(r, ['protocol', 'status', 'sqliteVersion', 'columns', 'rows'])
      || !Array.isArray(r.columns) || !r.columns.every(v => typeof v === 'string') || !Array.isArray(r.rows) || r.rows.length > 32
      || !r.rows.every(row => Array.isArray(row) && row.every(v => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))))) throw Error('Invalid rows');
    return { ...base, status: 'ok', sqliteVersion: r.sqliteVersion, columns: r.columns, rows: r.rows as (number | string)[][] };
  } catch { return { ...base, status: 'invalid_observation' }; }
}

export async function observePrSql(sql: string, parameters: string[], databaseRows: readonly PrSqlRow[] = PR_SQL_ROWS): Promise<PrSqlObservation> {
  return decodePrSqlObservation(await runInContainer(prSqlContainerOptions(sql, parameters, databaseRows)), sql);
}
export const expectedPrSqlRows = (name: string, databaseRows: readonly PrSqlRow[] = PR_SQL_ROWS) => databaseRows.filter(row => row.login === name).map(row => [row.id, row.login, row.role]);
const sorted = (rows: (number | string)[][]) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function matchesPrSqlName(observation: PrSqlObservation, name: string, databaseRows: readonly PrSqlRow[] = PR_SQL_ROWS): boolean {
  return observation.status === 'ok' && isDeepStrictEqual(observation.columns, ['id', 'login', 'role'])
    && isDeepStrictEqual(sorted(observation.rows ?? []), sorted(expectedPrSqlRows(name, databaseRows)));
}

export interface PrSqlEvidence {
  phase: 'original_witness' | 'reference_witness' | 'candidate_witness' | 'candidate_regression';
  id: string;
  worldId: string;
  fixtureHash: string;
  name: string;
  expectedRows: (number | string)[][];
  observation: PrSqlObservation;
  passed: boolean;
  unauthorizedRowIds?: number[];
}

export async function evaluatePrSqlWitness(output: string, options: { worldFactory?: () => PrSqlWorld[] } = {}) {
  const base = {
    protocol: 'pr-witness-sql-v1', experimental: false, registered: true, independentHumanGold: false,
    modelApiCalls: 0, originalFreeReviewUnchanged: true, source: PR_SQL_SOURCE,
    scope: 'New isolated SQLite fixture and SQL-template patch plus bound-name selector; not the original application/database, arbitrary TypeScript patch, or natural-language review certification',
    image: PR_SQL_IMAGE,
    unmeasured: ['free-form causality and prose', 'severity', 'logging', 'JWT', 'payment idempotency', 'architecture review', 'unseen databases and all possible inputs'],
  };
  const submission = parsePrSqlSubmission(output);
  const evidence: PrSqlEvidence[] = [];
  if (!submission) return { ...base, status: 'invalid_submission', accepted: false, evidence };
  // Factory injection is a trusted test seam, never read from candidate JSON.
  const worlds = (options.worldFactory ?? createPrSqlWorlds)();
  const report = { ...base, worlds, submission };
  if (!validWorlds(worlds)) return { ...report, status: 'world_configuration_invalid', accepted: false, evidence };
  const name = submission.witness.name;
  const originalSql = "SELECT * FROM users WHERE login = '" + name + "'";
  for (const world of worlds) {
    const worldEvidence = { worldId: world.id, fixtureHash: world.fixtureHash };
    const original = await observePrSql(originalSql, [], world.rows);
    const realUnauthorizedRows = world.rows.filter(row => row.login !== name).map(row => [row.id, row.login, row.role]);
    const unauthorized = original.status === 'ok' && isDeepStrictEqual(original.columns, ['id', 'login', 'role'])
      ? (original.rows ?? []).filter(row => realUnauthorizedRows.some(real => isDeepStrictEqual(row, real))).map(row => Number(row[0])) : [];
    evidence.push({ ...worldEvidence, phase: 'original_witness', id: 'witness-produces-extra-rows', name, expectedRows: expectedPrSqlRows(name, world.rows), observation: original, passed: unauthorized.length > 0, unauthorizedRowIds: unauthorized });
    if (original.infrastructureError) return { ...report, status: 'infrastructure_unavailable', accepted: false, evidence };
    const reference = await observePrSql(PR_SQL_REFERENCE.sql, [name], world.rows);
    evidence.push({ ...worldEvidence, phase: 'reference_witness', id: 'parameterized-reference-restores-contract', name, expectedRows: expectedPrSqlRows(name, world.rows), observation: reference, passed: matchesPrSqlName(reference, name, world.rows) });
    if (reference.infrastructureError) return { ...report, status: 'infrastructure_unavailable', accepted: false, evidence };
    if (!matchesPrSqlName(reference, name, world.rows)) return { ...report, status: 'reference_control_invalid', accepted: false, evidence };
    if (!unauthorized.length) return { ...report, status: 'witness_not_demonstrated', accepted: false, evidence };
  }
  // Container startup dominates this task. Replay candidate cases in bounded
  // groups of four: fast enough for routine runs without an unbounded Docker fanout.
  const candidateCases = worlds.flatMap(world => [{ id: 'candidate-same-witness', name, phase: 'candidate_witness' as const },
    ...prSqlWorldRegressions(world).map(test => ({ ...test, phase: 'candidate_regression' as const }))]
    .map(test => ({ world, test })));
  for (let offset = 0; offset < candidateCases.length; offset += 4) {
    const batch = candidateCases.slice(offset, offset + 4);
    const observations = await Promise.all(batch.map(({ world, test }) => observePrSql(submission.patch.sql, [test.name], world.rows)));
    for (const [index, observation] of observations.entries()) {
      const { world, test } = batch[index];
      evidence.push({ worldId: world.id, fixtureHash: world.fixtureHash, phase: test.phase, id: test.id, name: test.name,
        expectedRows: expectedPrSqlRows(test.name, world.rows), observation, passed: matchesPrSqlName(observation, test.name, world.rows) });
    }
    if (observations.some(observation => observation.infrastructureError))
      return { ...report, status: 'infrastructure_unavailable', accepted: false, evidence };
  }
  const accepted = evidence.every(item => item.passed);
  return { ...report, status: accepted ? 'verified_development_controls' : 'candidate_patch_failed', accepted, evidence,
    candidateChecks: evidence.filter(item => item.phase.startsWith('candidate')).length,
    candidatePassed: evidence.filter(item => item.phase.startsWith('candidate') && item.passed).length };
}

const makeSubmission = (sql: string, bindings: unknown = ['name']) => JSON.stringify({ protocol: 'pr-witness-sql-v1', witness: { name: "' OR 1=1 --" }, patch: { sql, bindings } });
export const PR_SQL_DEVELOPMENT_CONTROLS = [
  { id: 'correct-parameterized', output: makeSubmission(PR_SQL_REFERENCE.sql), accepted: true },
  { id: 'quoted-placeholder-fake-parameterization', output: makeSubmission("SELECT * FROM users WHERE login = '?'"), accepted: false },
  { id: 'declared-but-unused-parameter', output: makeSubmission("SELECT * FROM users WHERE login = '${name}'"), accepted: false },
  { id: 'reject-every-request', output: makeSubmission('SELECT * FROM users WHERE login = ? AND 0'), accepted: false },
  { id: 'unrestricted-or', output: makeSubmission('SELECT * FROM users WHERE login = ? OR 1=1'), accepted: false },
  { id: 'length-limit-rejects-valid-name', output: makeSubmission('SELECT * FROM users WHERE login = ?1 AND length(?1) < 100'), accepted: false },
  { id: 'params-not-bound', output: makeSubmission(PR_SQL_REFERENCE.sql, []), accepted: false },
  { id: 'hardcoded-original-table-ids', output: makeSubmission('SELECT * FROM users WHERE login = ? AND id IN (1,2,3,4,5,6,7)'), accepted: false },
  { id: 'conditional-alice-id-copy', output: makeSubmission("SELECT CASE WHEN login = 'alice' THEN 1 ELSE id END AS id, login, role FROM users WHERE login = ?"), accepted: false },
  { id: 'conditional-alice-role-copy', output: makeSubmission("SELECT id, login, CASE WHEN login = 'alice' THEN 'member' ELSE role END AS role FROM users WHERE login = ?"), accepted: false },
  { id: 'length-limit-200', output: makeSubmission('SELECT * FROM users WHERE login = ?1 AND length(?1) < 200'), accepted: false },
];
