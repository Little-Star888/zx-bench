import { readFileSync, writeFileSync } from 'node:fs';
import { buildEvidenceExam } from '../packages/core/dist/evaluationLab/evidenceExam/index.js';
import { buildExamPaper } from '../packages/core/dist/evaluationLab/examExpansion/index.js';
import { buildUltraMathQuestions } from '../packages/core/dist/evaluationLab/ultraMathQuestions.js';
import { ULTRA_MATH_RUBRICS } from '../packages/core/dist/evaluationLab/ultraMathRubric.js';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const root = new URL('../data/scenarios/', import.meta.url);
const bankPath = new URL('benchmark.json', root), metaPath = new URL('benchmark-meta.json', root);
const bank = JSON.parse(readFileSync(bankPath, 'utf8'));
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const release = JSON.parse(readFileSync(new URL('ultra-batch-release-manifest.json', root), 'utf8'));
const selectedMath = new Set(release.dimensions.reasoning_math.groups.map(x => x.id));
const evidence = buildEvidenceExam();
const expansion = buildExamPaper({ groupIds: [...selectedMath].filter(id => id.startsWith('MX3-')) });
const ultra = buildUltraMathQuestions(readFileSync(new URL('../docs/ultra-math-2026-09-14-questions.md', import.meta.url), 'utf8'));

const proofRubric = id => {
  const rubric = ULTRA_MATH_RUBRICS.find(x => x.id === id);
  return {
    version: 'ultra-math-rubric-2026-09-14-v1',
    criteria: rubric.criteria.map(c => ({ id: c.id, weight: c.points / rubric.points, description: c.description })),
    criticalErrors: ['核心结论错误。', '证明依赖未经证明的关键断言。', '分类或构造存在影响结论的遗漏。'],
    reference: '按每个评分点核查结论、证明和完备性；只给出结论不能获得证明项分数。',
  };
};
const allParts = [
  ...evidence.parts.map(p => ({ ...p, prompt: p.question.messages[0].content, hash: p.question.questionHash, grader: 'ultra_batch_part', language: 'json' })),
  ...expansion.parts.map(p => ({ ...p, dimension: 'reasoning_math', prompt: p.question.messages[0].content, hash: p.question.questionHash, grader: 'ultra_batch_part', language: 'json' })),
  ...ultra.questions.map(p => ({ ...p, dimension: 'reasoning_math', prompt: p.messages[0].content, hash: p.questionHash, grader: 'ultra_proof_part', language: 'general' })),
];
if (allParts.length !== 144 || new Set(allParts.map(x => x.id)).size !== 144) throw Error('Unexpected ultra batch size');
const added = allParts.map(part => {
  const requirements = { groupId: part.groupId, partNumber: part.number, points: part.points, hardSeconds: part.hardSeconds,
    questionHash: part.hash, sourcePackVersion: release.version,
    ...(part.grader === 'ultra_proof_part' ? { reviewedRubric: proofRubric(part.id) } : {}) };
  const scenario = { id: part.id, dimension: part.dimension, category: 'ultra_progressive_exam',
    difficulty: part.number < 2 ? 'hard' : 'adversarial', language: part.language, locale: 'zh-CN', status: 'valid', tier: 'public_dev',
    promptTemplate: part.prompt, grader: part.grader, graderVersion: '1.0.0', scoring: { type: 'weighted_axes' },
    hiddenTests: [], requirements, tags: ['ultra_difficulty', 'progressive_exam', `group_${part.groupId}`, `part_${part.number}`, `points_${part.points}`, `timeout_${part.hardSeconds}s`],
    scenarioVersion: '1.0.0', scenarioHash: '', responseMode: 'raw_output', outputPolicy: 'fenced_allowed',
    goldSource: release.version, goldVerifiedAt: '2026-09-14T00:00:00.000Z', reviewStatus: 'verified', maxAnswerTokens: 393216, maxReasoningTokens: 393216 };
  scenario.scenarioHash = hashScenarioShort(scenario);
  return scenario;
});
const ids = new Set(added.map(x => x.id));
const collisions = bank.filter(x => ids.has(x.id));
if (collisions.length) throw Error(`Refusing to overwrite: ${collisions.map(x => x.id).join(',')}`);
const next = [...bank, ...added].sort((a,b) => a.id.localeCompare(b.id, 'en'));
meta.version = '1.32.0'; meta.count = meta.validCount = next.filter(x => x.status === 'valid').length;
meta.totalCount = next.length + meta.retiredCount; meta.defaultRunCount += 144;
meta.generatedAt = '2026-09-14T00:00:00.000Z';
meta.dimensions = Object.fromEntries([...new Set(next.filter(x=>x.status==='valid').map(x=>x.dimension))].sort().map(d => [d, next.filter(x=>x.status==='valid'&&x.dimension===d).length]));
meta.ultraProgressiveExam = { version: release.version, definitions: 144, groups: 36, partsPerGroup: 4, defaultRunEligible: true };
release.defaultAtomicBank = true; release.status = 'active_formal_bank'; release.qualityGates.officialLeaderboardRequiresProspectiveScreen = false;
writeFileSync(bankPath, JSON.stringify(next, null, 2)+'\n');
writeFileSync(metaPath, JSON.stringify(meta, null, 1)+'\n');
writeFileSync(new URL('ultra-batch-release-manifest.json', root), JSON.stringify(release, null, 2)+'\n');
console.log(JSON.stringify({added:added.length,total:next.length,dimensions:meta.dimensions}));
