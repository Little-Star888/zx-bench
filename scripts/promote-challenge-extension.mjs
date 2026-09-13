// Prospective-only promotion. Does not access the database or any model API.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildChallengeExtension } from '../packages/core/dist/evaluationLab/challengeExtension.js';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';
const root = new URL('../data/scenarios/', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const write = (name, value) => writeFileSync(new URL(name, root), JSON.stringify(value, null, 1) + '\n');
const bank = read('benchmark.json'), meta = read('benchmark-meta.json'), pack = buildChallengeExtension();
if (pack.cases.length !== 21 || new Set(pack.cases.map(c => c.id)).size !== 21) throw Error('Unexpected extension scope');
// Project-repair questions predate this extension and remain part of the formal bank.
// Quality/audit limitations are metadata; they must not silently change user-selected scope.
for (const scenario of bank.filter(item => item.grader === 'project_repair')) {
  const { developmentShadow: _removed, ...requirements } = scenario.requirements ?? {};
  scenario.requirements = requirements;
  scenario.tags = (scenario.tags ?? []).filter(tag => !['development_shadow', 'explicit_run_only'].includes(tag));
  scenario.scenarioHash = hashScenarioShort(scenario);
}
const added = pack.cases.map(item => {
  const scenario = {
    id: item.id, dimension: item.dimension, category: item.kind === 'probability' ? item.family : 'challenge_extension',
    // Coverage-screen all-pass items are not labelled as calibrated adversarial questions.
    difficulty: item.kind === 'coverage' ? 'medium' : 'hard', language: 'json', locale: 'zh-CN',
    status: 'valid', tier: 'public_dev', promptTemplate: item.prompt,
    grader: 'challenge_extension', graderVersion: '1.0.0',
    scoring: { type: 'binary_pass_fail', weights: { challenge_answer: 1 } },
    hiddenTests: [], requirements: { challengeId: item.id, sourcePackVersion: pack.version, sourcePackHash: pack.hash,
      ...(item.developmentShadow ? { developmentShadow: true } : {}) },
    tags: ['deterministic', 'no_judge', 'prospective_only', `challenge_${item.kind}`,
      ...(item.kind === 'coverage' ? ['pilot_ceiling_not_discrimination_evidence'] : []),
      ...(item.kind === 'probability' ? [`family_${item.family}`, `variant_${item.source.variant}`] : []),
      ...(item.developmentShadow ? ['development_shadow', 'explicit_run_only', 'difficulty_unvalidated'] : [])],
    scenarioVersion: '1.0.0', scenarioHash: '', responseMode: 'raw_output', outputPolicy: 'fenced_allowed',
    goldSource: `${pack.version}:programmatic-gold-replay`, goldVerifiedAt: '2026-09-13T00:00:00.000Z',
    reviewStatus: 'verified', maxReasoningTokens: 90000,
  };
  scenario.scenarioHash = hashScenarioShort(scenario);
  const previous = bank.find(s => s.id === scenario.id);
  if (previous && JSON.stringify(previous) !== JSON.stringify(scenario)) throw Error(`Refusing to overwrite existing definition ${scenario.id}`);
  return scenario;
});
const ids = new Set(added.map(s => s.id));
const next = [...bank.filter(s => !ids.has(s.id)), ...added].sort((a, b) => a.id.localeCompare(b.id, 'en'));
const valid = next.filter(s => s.status === 'valid');
const defaultCount = valid.filter(s => !s.requirements?.developmentShadow).length;
if (next.length !== 621 || defaultCount !== 620) throw Error('Unexpected bank/default counts');
meta.version = '1.31.1';
meta.count = meta.validCount = valid.length;
meta.totalCount = next.length + meta.retiredCount;
meta.defaultRunCount = defaultCount;
meta.generatedAt = '2026-09-13T00:00:00.000Z';
meta.dimensions = Object.fromEntries([...new Set(valid.map(s => s.dimension))].sort().map(d => [d, valid.filter(s => s.dimension === d).length]));
Object.assign(meta.lightweightReleasePolicy.projectRepair, {
  status: 'formal_with_disclosed_audit_limitations', officialScoreEligible: 20,
  defaultRunEligible: true, explicitRunOnly: false,
});
const manifest = { version: pack.version, bankVersion: meta.version, sourceHash: pack.hash,
  grader: 'challenge_extension@1.0.0', judgeWeight: 0, definitions: 21, defaultRunAdditions: 20,
  coverageIds: pack.cases.filter(c => c.kind === 'coverage').map(c => c.id),
  probabilityIds: pack.cases.filter(c => c.kind === 'probability').map(c => c.id),
  explicitOnlyIds: ['MC2-004-R1'], originalUnreleasedIds: ['MC2-004'],
  review: 'maintainer integration review plus deterministic positive/negative replay; not independent human review',
  limitations: ['Coverage items were previously all-pass in the pilot; no new discrimination claim.',
    'Six probability items represent two families with base/parameter/irrelevant variants, not six independent families.',
    'MC2-004-R1 lacks a model difficulty pilot and is explicit-only.',
    'Unparseable probability output is unmeasured, not evidence of mathematical failure.'],
  projectRepairScopeRestored: 20, historicalScoresChanged: false,
};
meta.challengeExtension = manifest;
write('benchmark.json', next);
write('benchmark-meta.json', meta);
write('challenge-extension-manifest.json', manifest);
console.log(JSON.stringify({ version: meta.version, definitions: next.length, defaultCount, extension: added.length, hash: pack.hash }));
