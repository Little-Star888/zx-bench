import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Exercise the real CLI against disposable, synthetic databases only. Never use
// the application's database, model answers, credentials or user run records.
const root = fileURLToPath(new URL('../../../', import.meta.url));
// Vite 5 predates node:sqlite; use Node's loader for the native builtin.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const script = join(root, 'scripts', 'sync-reviewed-question-contracts.mjs');
const prefix = 'zxbench-definition-sync-test-';
const ownedDirectories = new Set<string>();
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

afterEach(() => {
  for (const directory of ownedDirectories) {
    // Verify each exact, newly created directory before recursive cleanup. A
    // changed path or symlink must not turn test cleanup into a broad deletion.
    const canonical = realpathSync(directory);
    if (dirname(canonical) !== realpathSync(tmpdir()) || !basename(canonical).startsWith(prefix)
      || canonical !== realpathSync(resolve(directory)) || lstatSync(directory).isSymbolicLink()) {
      throw new Error('Refusing cleanup outside the owned definition-sync fixture');
    }
    rmSync(canonical, { recursive: true, force: true });
    ownedDirectories.delete(directory);
  }
});

function fixture(status = 'completed') {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  ownedDirectories.add(directory);
  const database = join(directory, 'synthetic.sqlite');
  const db = new DatabaseSync(database);
  try {
    db.exec(`
      CREATE TABLE ScenarioDefinition (
        id TEXT PRIMARY KEY, dimension TEXT, grader TEXT, graderVersion TEXT,
        scenarioHash TEXT, requirements TEXT, hiddenTests TEXT,
        createdAt INTEGER, updatedAt INTEGER
      );
      CREATE TABLE EvalRun (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, summary TEXT, score REAL
      );
      CREATE TABLE ScenarioResult (
        id TEXT PRIMARY KEY, runId TEXT, scenarioId TEXT, status TEXT,
        score REAL, output TEXT, metadata TEXT
      );
    `);
    db.prepare('INSERT INTO ScenarioDefinition VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('synthetic-unrelated', 'fixture-only', 'untouched', '0', 'sentinel-hash', '{"keep":true}', '[]', 1, 2);
    db.prepare('INSERT INTO EvalRun VALUES (?, ?, ?, ?)')
      .run('synthetic-run', status, '{"fixture":true,"note":"not a user run"}', 12.5);
    const insert = db.prepare('INSERT INTO ScenarioResult VALUES (?, ?, ?, ?, ?, ?, ?)');
    // Deliberately preserve two historical rows for one synthetic scenario.
    insert.run('result-z', 'synthetic-run', 'synthetic-question', 'success', 12.5, 'fixture answer A', '{"attempt":1}');
    insert.run('result-a', 'synthetic-run', 'synthetic-question', 'error', 0, 'fixture answer B 🧪', '{"attempt":2}');
  } finally { db.close(); }
  return { directory, database };
}

function snapshot(database: string) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const tables = Object.fromEntries(['ScenarioResult', 'EvalRun'].map(table => {
      const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
      return [table, { rows, hash: hash(rows.map(row => JSON.stringify(row) + '\n').join('')) }];
    }));
    return {
      tables,
      definitions: db.prepare('SELECT * FROM ScenarioDefinition ORDER BY id').all(),
    };
  } finally { db.close(); }
}

function invoke(database: string, apply = false) {
  return spawnSync(process.execPath, [script, database, '--execution-review', ...(apply ? ['--apply'] : [])], {
    cwd: root, encoding: 'utf8', timeout: 30_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
  });
}

describe('real definition-sync CLI preserves synthetic historical records', () => {
  it('dry-run reports 171 reviewed definitions without changing any database bytes or creating files', () => {
    const { directory, database } = fixture();
    const before = readFileSync(database);
    const state = snapshot(database);
    const result = invoke(database);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      dryRun: true, count: 171, before: { results: 2, runs: 1 }, active: 0, scope: 'execution-review',
    });
    expect(readFileSync(database)).toEqual(before);
    expect(snapshot(database)).toEqual(state);
    expect(readdirSync(directory)).toEqual(['synthetic.sqlite']);
  });

  it('apply writes all 171 reviewed definitions while preserving exact historical contents and SHA-256 hashes', () => {
    const { directory, database } = fixture();
    const before = snapshot(database);
    const reviewed = JSON.parse(readFileSync(join(root, 'data/scenarios/benchmark.json'), 'utf8'))
      .filter((s: { grader: string }) => ['code_repair', 'instruction_checklist', 'llm_judge', 'pr_executable_evidence'].includes(s.grader));
    expect(reviewed).toHaveLength(171);
    const result = invoke(database, true);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      applied: 171, before: { results: 2, runs: 1 }, after: { results: 2, runs: 1 },
      historyHashes: {
        ScenarioResult: before.tables.ScenarioResult.hash,
        EvalRun: before.tables.EvalRun.hash,
      },
    });
    const after = snapshot(database);
    expect(after.tables).toEqual(before.tables);
    expect(after.definitions).toHaveLength(172);
    expect(after.definitions.find(row => row.id === 'synthetic-unrelated')).toEqual(before.definitions[0]);
    for (const scenario of reviewed) {
      expect(after.definitions.find(row => row.id === scenario.id)).toMatchObject({
        dimension: scenario.dimension, grader: scenario.grader, graderVersion: scenario.graderVersion,
        scenarioHash: scenario.scenarioHash,
      });
    }
    expect(dirname(resolve(report.backupPath))).toBe(resolve(directory));
    expect(basename(report.backupPath)).toMatch(/^synthetic\.sqlite\.reviewed-\d+\.bak$/);
    expect(snapshot(report.backupPath)).toEqual(before);
    expect(readdirSync(directory).sort()).toEqual(['synthetic.sqlite', basename(report.backupPath)].sort());
  });

  it('detects same-row-count historical content changes and rolls back all definition writes', () => {
    const { directory, database } = fixture();
    const db = new DatabaseSync(database);
    try {
      // Synthetic fault injection: row counts alone cannot detect this mutation.
      db.exec(`CREATE TRIGGER synthetic_history_tamper AFTER INSERT ON ScenarioDefinition
        WHEN NEW.id != 'synthetic-unrelated'
        BEGIN UPDATE ScenarioResult SET score = 99 WHERE id = 'result-a'; END;`);
    } finally { db.close(); }
    const before = snapshot(database);
    const result = invoke(database, true);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Historical contents changed');
    expect(snapshot(database)).toEqual(before);
    const backups = readdirSync(directory).filter(name => name.endsWith('.bak'));
    expect(backups).toHaveLength(1);
    expect(snapshot(join(directory, backups[0]))).toEqual(before);
  });

  it.each(['running', 'pending', 'queued'])('refuses apply while an existing run is %s and leaves the fixture byte-for-byte intact', status => {
    const { directory, database } = fixture(status);
    const before = readFileSync(database);
    const state = snapshot(database);
    const result = invoke(database, true);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Refusing definition update while a run is active');
    expect(readFileSync(database)).toEqual(before);
    expect(snapshot(database)).toEqual(state);
    expect(readdirSync(directory)).toEqual(['synthetic.sqlite']);
  });
});
