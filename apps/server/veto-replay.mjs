import Database from 'better-sqlite3';
import { reviewedHallucination } from '../packages/core/dist/evaluators/reviewedHallucination.js';

const db = new Database('J:/AI/zxbench-runtime/data/zxbench.db', { readonly: true });
const RID = 'zxbench-pro-2026-09-15T02-29-21-240Z-080de7b9';
const rows = db.prepare(`
  SELECT r.scenarioId, r.modelOutput, r.totalScore, d.promptTemplate, d.requirements, d.answerFirst, d.status
  FROM ScenarioResult r JOIN ScenarioDefinition d ON d.id = r.scenarioId
  WHERE r.evalRunId = ? AND r.graderVersion = 'hallucination_resistance@hallucination_v6'
`).all(RID);

let vetoed = [], semantic = 0, detFact = 0, detVeto = 0;
for (const r of rows) {
  const scenario = {
    id: r.scenarioId, promptTemplate: r.promptTemplate,
    requirements: JSON.parse(r.requirements), answerFirst: r.answerFirst === 1 || r.answerFirst === true,
  };
  const res = reviewedHallucination(scenario, r.modelOutput || '');
  const ev = (res.evidence || []).join(' | ');
  if (ev.includes('DETERMINISTIC_VETO')) {
    // 区分：新红线 veto（fictional/rag）vs 原有 offline-answer veto
    if (ev.includes('fictional_citation') || ev.includes('rag_attribution')) vetoed.push({ id: r.scenarioId, ev, old: r.totalScore });
    else detVeto++;
  } else if (ev.includes('DETERMINISTIC_FACT')) detFact++;
  else semantic++;
}
console.log(`回放 ${rows.length} 题: 新红线 veto ${vetoed.length} | 原offline veto ${detVeto} | DET_FACT ${detFact} | SEMANTIC ${semantic}`);
console.log('\n=== 新红线 veto 命中明细 ===');
for (const v of vetoed) console.log(`  ${v.id} (原分 ${v.old})\n    ${v.ev}`);
