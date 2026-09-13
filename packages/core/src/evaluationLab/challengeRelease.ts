/** Frozen, prospective-only challenge supplement selected by the lightweight gate. */
export const CHALLENGE_SUPPLEMENT_VERSION = 'challenge-supplement-2026-09-13-v1';
export const CHALLENGE_SUPPLEMENT_GRADER_VERSION = '1.0.0';
export const CHALLENGE_SUPPLEMENT_SOURCE_VERSION = 'capability-challenge-2026-09-10-v1.3.0';
export const CHALLENGE_SUPPLEMENT_SOURCE_HASH = '42929b253e9e2f4d32568c5e164ab4fcb651cca3712b6472950c7907c2ed10e3';

export const CHALLENGE_SUPPLEMENT_IDS = [
  'HC3-002',
  'HC3-007',
  'MC2-001',
  'MC2-002',
  'MC2-006',
] as const;

export const CHALLENGE_SUPPLEMENT_ID_SET = new Set<string>(CHALLENGE_SUPPLEMENT_IDS);
