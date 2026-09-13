import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerRunDeletion } from './runDeletion.js';

let app: FastifyInstance;
let db: PrismaClient;
let directory: string;
const busy = vi.fn(() => false);
const clearCache = vi.fn();

beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'zxbench-delete-test-'));
  db = new PrismaClient({ datasourceUrl: `file:${path.join(directory, 'test.db').replace(/\\/g, '/')}` });
  await db.$executeRawUnsafe('CREATE TABLE EvalRun (id TEXT PRIMARY KEY, status TEXT NOT NULL, parentRunId TEXT, updatedAt DATETIME DEFAULT 0)');
  await db.$executeRawUnsafe('CREATE TABLE ScenarioResult (id TEXT PRIMARY KEY, evalRunId TEXT REFERENCES EvalRun(id) ON DELETE CASCADE)');
  await db.$executeRawUnsafe("INSERT INTO EvalRun (id,status,parentRunId) VALUES ('parent','completed',NULL),('child','failed','parent'),('other','cancelled',NULL)");
  await db.$executeRawUnsafe("INSERT INTO ScenarioResult VALUES ('r1','parent'),('r2','child'),('r3','other')");
  busy.mockReset().mockReturnValue(false);
  clearCache.mockReset();
  app = Fastify();
  registerRunDeletion(app, db, busy, clearCache);
});
afterEach(async () => {
  await app.close();
  await db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});
const remove = (ids: unknown) => app.inject({ method: 'POST', url: '/api/runs/delete', payload: { ids } });
const runs = () => db.evalRun.findMany({ select: { id: true, parentRunId: true }, orderBy: { id: 'asc' } });
const results = () => db.scenarioResult.count();

describe('history deletion with an isolated real SQLite database', () => {
  it('deletes only explicit IDs and their results; keeps and detaches descendants', async () => {
    const response = await remove(['parent']);
    expect(response.statusCode, response.body).toBe(200);
    expect(await runs()).toEqual([{ id: 'child', parentRunId: null }, { id: 'other', parentRunId: null }]);
    expect(await results()).toBe(2);
    expect(clearCache).toHaveBeenCalledTimes(1);
    expect(clearCache).toHaveBeenCalledWith('parent');
  });
  it('deletes a selected group atomically and accepts duplicate IDs', async () => {
    const response = await remove(['parent', 'child', 'parent']);
    expect(response.json().data.deletedIds).toEqual(['parent', 'child']);
    expect(await results()).toBe(1);
    expect(await runs()).toEqual([{ id: 'other', parentRunId: null }]);
  });
  it.each(['pending', 'running'])('rejects the entire group when one run is %s', async status => {
    await db.$executeRaw`UPDATE EvalRun SET status=${status} WHERE id='child'`;
    expect((await remove(['parent', 'child'])).statusCode).toBe(409);
    expect(await results()).toBe(3);
    expect(await runs()).toHaveLength(3);
  });
  it.each(['paused', 'failed', 'cancelled', 'completed'])('allows inactive %s records', async status => {
    await db.$executeRaw`UPDATE EvalRun SET status=${status} WHERE id='other'`;
    expect((await remove(['other'])).statusCode).toBe(200);
  });
  it('protects live controllers and background Judge jobs even with a terminal DB status', async () => {
    busy.mockReturnValue(true);
    expect((await remove(['parent'])).statusCode).toBe(409);
    expect(await results()).toBe(3);
  });
  it('does not partially delete a stale selection', async () => {
    expect((await remove(['parent', 'missing'])).statusCode).toBe(404);
    expect(await results()).toBe(3);
    expect(clearCache).not.toHaveBeenCalled();
  });
  it.each([[], null, [''], [1], 'parent'])('rejects invalid IDs: %j', async ids => {
    expect((await remove(ids)).statusCode).toBe(400);
    expect(await results()).toBe(3);
  });
  it('rolls back result deletion and parent detachment if deleting the run fails', async () => {
    await db.$executeRawUnsafe("CREATE TRIGGER fail_delete BEFORE DELETE ON EvalRun BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    expect((await remove(['parent'])).statusCode).toBe(500);
    expect(await results()).toBe(3);
    expect((await runs()).find(run => run.id === 'child')?.parentRunId).toBe('parent');
    expect(clearCache).not.toHaveBeenCalled();
  });
  it('rejects deletion while a retry is in flight and releases the guard afterwards', async () => {
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    app.post('/api/runs/:id/results/:scenarioId/retry', async () => {
      started();
      await new Promise<void>(resolve => { release = resolve; });
      return { success: true };
    });
    const retry = app.inject({ method: 'POST', url: '/api/runs/parent/results/q/retry' }).then(value => value);
    await entered;
    expect((await remove(['parent'])).statusCode).toBe(409);
    release();
    await retry;
    expect((await remove(['parent'])).statusCode).toBe(200);
  });
});
