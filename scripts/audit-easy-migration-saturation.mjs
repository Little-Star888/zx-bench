import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const bank = JSON.parse(fs.readFileSync('data/scenarios/benchmark.json', 'utf8'));
const inventory = JSON.parse(fs.readFileSync('data/pilots/five-dimension-migration-inventory.json', 'utf8'));
const ids = inventory.filter(item => item.status === 'pending_fixture'
  && bank.find(source => source.id === item.sourceId)?.difficulty === 'easy').map(item => item.sourceId);
const db = new DatabaseSync('apps/data/zxbench.db', { readOnly: true });
try {
  const runs = db.prepare(`SELECT r.id,r.modelConfigId,r.createdAt,count(s.id) n
    FROM EvalRun r JOIN ScenarioResult s ON s.evalRunId=r.id WHERE r.status='completed'
    GROUP BY r.id HAVING n>=700 ORDER BY r.createdAt DESC`).all();
  const seen = new Set();
  const selected = runs.filter(run => !seen.has(run.modelConfigId) && seen.add(run.modelConfigId)).slice(0, 7);
  const result = ids.map(id => {
    const source = bank.find(item => item.id === id);
    const rows = selected.map(run => {
      const record = db.prepare(`SELECT totalScore,scenarioVersion,graderVersion,environmentError,outputMetadata
        FROM ScenarioResult WHERE evalRunId=? AND scenarioId=?`).get(run.id, id);
      if (!record) return { runId: run.id, score: null, comparable: false };
      const metadata = JSON.parse(record.outputMetadata ?? '{}');
      const comparable = !record.environmentError && !metadata.truncated
        && metadata.evaluationAudit?.scenarioHash === source.scenarioHash
        && record.scenarioVersion === source.scenarioVersion;
      return { runId: run.id, modelId: run.modelConfigId, score: record.totalScore, comparable };
    });
    return { id, comparable: rows.filter(row => row.comparable).length,
      allComparableFull: rows.length === 7 && rows.every(row => row.comparable && row.score === 100),
      scores: rows.map(row => row.comparable ? row.score : null) };
  });
  console.log(JSON.stringify({ selectedRuns: selected.length, items: result }, null, 2));
} finally { db.close(); }
