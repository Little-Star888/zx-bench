// Idempotently promote the five screened challenge questions and mark project-repair
// questions as explicit-only development shadow tasks.
import { readFileSync, writeFileSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';
import { buildChallengePack, candidateQuestion } from '../packages/core/dist/evaluationLab/challengePack.js';
import {
  CHALLENGE_SUPPLEMENT_GRADER_VERSION,
  CHALLENGE_SUPPLEMENT_IDS,
  CHALLENGE_SUPPLEMENT_SOURCE_HASH,
  CHALLENGE_SUPPLEMENT_SOURCE_VERSION,
  CHALLENGE_SUPPLEMENT_VERSION,
} from '../packages/core/dist/evaluationLab/challengeRelease.js';

const bankPath = new URL('../data/scenarios/benchmark.json', import.meta.url);
const metaPath = new URL('../data/scenarios/benchmark-meta.json', import.meta.url);
const bank = JSON.parse(readFileSync(bankPath, 'utf8'));
const pack = buildChallengePack();
if (pack.version !== CHALLENGE_SUPPLEMENT_SOURCE_VERSION || pack.hash !== CHALLENGE_SUPPLEMENT_SOURCE_HASH) {
  throw new Error('Frozen challenge source pack drifted; refusing promotion');
}

for (const scenario of bank.filter((item) => item.grader === 'project_repair')) {
  scenario.requirements = { ...scenario.requirements, developmentShadow: true };
  scenario.tags = [...new Set([...(scenario.tags ?? []), 'development_shadow', 'explicit_run_only'])];
  scenario.scenarioHash = hashScenarioShort(scenario);
}

const promoted = CHALLENGE_SUPPLEMENT_IDS.map((id) => {
  const challenge = pack.cases.find((item) => item.id === id);
  if (!challenge) throw new Error(`Challenge ${id} missing from frozen source pack`);
  const prompt = candidateQuestion(challenge).messages[1].content;
  const scenario = {
    id,
    dimension: challenge.dimension,
    category: 'challenge_supplement',
    difficulty: 'adversarial',
    language: 'json',
    locale: 'zh-CN',
    status: 'valid',
    tier: 'private_validation',
    promptTemplate: prompt,
    sourceCode: null,
    functionName: null,
    expectedVerdict: null,
    grader: 'challenge_supplement',
    graderVersion: CHALLENGE_SUPPLEMENT_GRADER_VERSION,
    scoring: { type: 'binary_pass_fail', weights: { challenge_strict: 1 } },
    hiddenTests: [],
    requirements: {
      challengeId: id,
      sourcePackVersion: CHALLENGE_SUPPLEMENT_SOURCE_VERSION,
      sourcePackHash: CHALLENGE_SUPPLEMENT_SOURCE_HASH,
      releaseVersion: CHALLENGE_SUPPLEMENT_VERSION,
    },
    tags: ['challenge', 'deterministic', 'no_judge', 'prospective_only'],
    scenarioVersion: '1.0.0',
    scenarioHash: '',
    responseMode: 'raw_output',
    outputPolicy: 'fenced_allowed',
    environmentImage: null,
    seed: null,
    goldSource: `${CHALLENGE_SUPPLEMENT_VERSION}:deterministic-oracle`,
    // Persist the canonical UTC spelling used by Prisma's DateTime round-trip.
    goldVerifiedAt: '2026-09-12T16:00:00.000Z',
    reviewStatus: 'verified',
    answerFirst: null,
    maxAnswerTokens: null,
    maxReasoningTokens: 90000,
  };
  scenario.scenarioHash = hashScenarioShort(scenario);
  return scenario;
});

const promotedIds = new Set(CHALLENGE_SUPPLEMENT_IDS);
const next = [...bank.filter((item) => !promotedIds.has(item.id)), ...promoted]
  .sort((a, b) => a.id.localeCompare(b.id, 'en'));
writeFileSync(bankPath, JSON.stringify(next, null, 1) + '\n');

const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const valid = next.filter((item) => item.status === 'valid');
meta.version = '1.30.0';
meta.count = valid.length;
meta.validCount = valid.length;
meta.totalCount = next.length + Number(meta.retiredCount ?? 0);
meta.dimensions = Object.fromEntries([...new Set(valid.map((item) => item.dimension))].sort()
  .map((dimension) => [dimension, valid.filter((item) => item.dimension === dimension).length]));
meta.generatedAt = '2026-09-13T00:00:00.000+08:00';
meta.lightweightReleasePolicy.projectRepair.defaultRunEligible = false;
meta.lightweightReleasePolicy.projectRepair.explicitRunOnly = true;
meta.lightweightReleasePolicy.challengeDiscrimination.currentPilot.promotedIds = [...CHALLENGE_SUPPLEMENT_IDS];
meta.lightweightReleasePolicy.challengeDiscrimination.currentPilot.promotedForProspectiveRuns = true;
meta.lightweightReleasePolicy.challengeDiscrimination.currentPilot.nextRequiredAction = 'run prospective model comparisons on the five frozen questions; redesign MC2-004 separately';
meta.challengeSupplement = {
  version: CHALLENGE_SUPPLEMENT_VERSION,
  grader: `challenge_supplement@${CHALLENGE_SUPPLEMENT_GRADER_VERSION}`,
  count: promoted.length,
  ids: [...CHALLENGE_SUPPLEMENT_IDS],
  judgeWeight: 0,
  scoring: 'deterministic_binary_strict_pass',
  sourcePackVersion: CHALLENGE_SUPPLEMENT_SOURCE_VERSION,
  sourcePackHash: CHALLENGE_SUPPLEMENT_SOURCE_HASH,
  prospectiveOnly: true,
};
writeFileSync(metaPath, JSON.stringify(meta, null, 1) + '\n');
console.log(JSON.stringify({ version: meta.version, definitions: next.length, valid: valid.length, promoted: promoted.length, shadow: next.filter((item) => item.requirements?.developmentShadow === true).length }));
