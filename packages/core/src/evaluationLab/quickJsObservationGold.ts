import type { QuickJsObservationCase, QuickJsObservationContract } from '../execution/quickJsObservation.js';
import { QUICKJS_OBSERVATION_V2_PILOTS } from './quickJsObservationV2Gold.js';

/** Development controls only: not independently reviewed gold, not held-out tests,
 * The migration script may copy only `contract` to the formal bank after the
 * runtime checks pass; this module itself does not mutate/register anything.
 * Original test IDs belong only to `contract`; challenge cases are deliberately
 * separate so stronger checks cannot silently change historical scoring. */
export interface QuickJsObservationFixture {
  language: 'javascript';
  contract: QuickJsObservationContract;
  correct: string;
  mutants: { id: string; description: string; code: string }[];
  developmentCases: QuickJsObservationCase[];
  notes: string[];
}

const chunkCorrect = `function chunk(arr, size) {
  if (size <= 0) throw new RangeError('size must be positive');
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}`;

const parseRangeCorrect = `function parseRange(s) {
  if (!/^\\d+(?:-\\d+)?$/.test(s)) throw new Error('invalid range');
  const parts = s.split('-').map(Number);
  const start = parts[0], end = parts.length === 1 ? start : parts[1];
  if (start > end) throw new Error('reversed range');
  const result = [];
  for (let i = start; i <= end; i++) result.push(i);
  return result;
}`;

const deepMergeCorrect = `function deepMerge(a, b) {
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const copy = value => Array.isArray(value) ? value.map(copy)
    : isObject(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]))
    : value;
  const out = copy(a);
  for (const key of Object.keys(b)) {
    out[key] = isObject(out[key]) && isObject(b[key]) ? deepMerge(out[key], b[key]) : copy(b[key]);
  }
  return out;
}`;

const trimHistoryCorrect = `function trimHistory(messages, maxTokens) {
  const protectedIndex = messages.findIndex(message => message.role === 'system');
  let total = messages.reduce((sum, message) => sum + message.tokens, 0);
  const kept = [];
  for (let index = 0; index < messages.length; index++) {
    if (index !== protectedIndex && total > maxTokens) {
      total -= messages[index].tokens;
      continue;
    }
    kept.push(messages[index]);
  }
  return kept;
}`;

export const QUICKJS_OBSERVATION_PILOTS: Record<string, QuickJsObservationFixture> = {
  ...QUICKJS_OBSERVATION_V2_PILOTS,
  'CP-L1-JS-002': {
    language: 'javascript',
    contract: { protocol: 'quickjs-observation-v1', entrypoint: 'chunk', cases: [
      { id: 'CP-L1-JS-002-hidden-1', calls: [[[1, 2, 3, 4, 5], 2]], expected: [{ outcome: { kind: 'return', value: [[1, 2], [3, 4], [5]] } }] },
      { id: 'CP-L1-JS-002-hidden-2', calls: [[[1, 2, 3, 4], 2]], expected: [{ outcome: { kind: 'return', value: [[1, 2], [3, 4]] } }] },
      { id: 'CP-L1-JS-002-hidden-3', calls: [[[], 3]], expected: [{ outcome: { kind: 'return', value: [] } }] },
      { id: 'CP-L1-JS-002-hidden-4', calls: [[[1, 2], 0]], expected: [{ outcome: { kind: 'throw', errorType: 'RangeError' } }] },
      { id: 'CP-L1-JS-002-hidden-5', calls: [[[1, 2, 3], 5]], expected: [{ outcome: { kind: 'return', value: [[1, 2, 3]] } }] },
    ] },
    correct: chunkCorrect,
    mutants: [
      { id: 'wrong-error-class', description: 'Computes valid chunks but throws Error instead of RangeError.', code: chunkCorrect.replace("new RangeError('size must be positive')", "new Error('size must be positive')") },
      { id: 'drops-short-tail', description: 'Drops the final incomplete chunk, including size greater than input length.', code: chunkCorrect.replace('i < arr.length', 'i + size <= arr.length') },
      { id: 'rejects-zero-only', description: 'Passes the old exception point but returns an empty array for negative size.', code: chunkCorrect.replace("if (size <= 0) throw new RangeError('size must be positive');", "if (size === 0) throw new RangeError('size must be positive');\n  if (size < 0) return [];") },
    ],
    developmentCases: [
      { id: 'CP-L1-JS-002-dev-negative-size', calls: [[[1, 2, 3], -2]], expected: [{ outcome: { kind: 'throw', errorType: 'RangeError' } }] },
      { id: 'CP-L1-JS-002-dev-empty-invalid-size', calls: [[[], 0]], expected: [{ outcome: { kind: 'throw', errorType: 'RangeError' } }] },
    ],
    notes: ['Old size<=0 test exercises zero only; negative-size controls are separate development challenges.'],
  },
  'CP-L2-TD-JS-001': {
    language: 'javascript',
    contract: { protocol: 'quickjs-observation-v1', entrypoint: 'parseRange', cases: [
      { id: 'CP-L2-TD-JS-001-hidden-1', calls: [['2-5']], expected: [{ outcome: { kind: 'return', value: [2, 3, 4, 5] } }] },
      { id: 'CP-L2-TD-JS-001-hidden-2', calls: [['3']], expected: [{ outcome: { kind: 'return', value: [3] } }] },
      { id: 'CP-L2-TD-JS-001-hidden-3', calls: [['5-2']], expected: [{ outcome: { kind: 'throw' } }] },
      { id: 'CP-L2-TD-JS-001-hidden-4', calls: [['a-b']], expected: [{ outcome: { kind: 'throw' } }] },
    ] },
    correct: parseRangeCorrect,
    mutants: [
      { id: 'exclusive-upper-bound', description: 'Preserves single-point syntax but drops the inclusive range endpoint.', code: parseRangeCorrect.replace('i <= end', 'i < end + (parts.length === 1 ? 1 : 0)') },
      { id: 'accepts-reversed-range', description: 'Returns an empty array instead of throwing for descending ranges.', code: parseRangeCorrect.replace("if (start > end) throw new Error('reversed range');", 'if (start > end) return [];') },
    ],
    developmentCases: [
      { id: 'CP-L2-TD-JS-001-dev-equal-endpoints', calls: [['5-5']], expected: [{ outcome: { kind: 'return', value: [5] } }] },
      { id: 'CP-L2-TD-JS-001-dev-zero-single', calls: [['0']], expected: [{ outcome: { kind: 'return', value: [0] } }] },
      { id: 'CP-L2-TD-JS-001-dev-mixed-nonnumeric', calls: [['2-x']], expected: [{ outcome: { kind: 'throw' } }] },
    ],
    notes: [
      'The task does not specify an exception class; any genuinely thrown exception satisfies its two old error points.',
      'Negative-number, whitespace, decimal and scientific-notation grammars are not specified by the task and are not asserted by these controls.',
    ],
  },
  'CP-L2-JS-004': {
    language: 'javascript',
    contract: { protocol: 'quickjs-observation-v1', entrypoint: 'deepMerge', cases: [
      {
        id: 'CP-L2-JS-004-hidden-1',
        calls: [[{ a: 1, b: { x: 1 } }, { b: { y: 2 }, c: 3 }]],
        expected: [{ outcome: { kind: 'return', value: { a: 1, b: { x: 1, y: 2 }, c: 3 } } }],
      },
      {
        id: 'CP-L2-JS-004-hidden-2',
        calls: [[{ b: { x: 1 } }, { b: { y: 2 } }]],
        expected: [{ outcome: { kind: 'return' }, argumentChecks: [{ index: 0, value: { b: { x: 1 } } }] }],
      },
      {
        id: 'CP-L2-JS-004-hidden-3',
        calls: [[{ arr: [1, 2] }, { arr: [9] }]],
        expected: [{ outcome: { kind: 'return', valueAt: [{ path: ['arr'], value: [9] }] } }],
      },
    ] },
    correct: deepMergeCorrect,
    mutants: [
      { id: 'mutates-first-argument', description: 'Merges the right values into a instead of producing an independent output.', code: deepMergeCorrect.replace('const out = copy(a);', 'const out = a;') },
      { id: 'overwrites-nested-objects', description: 'Treats nested objects like arrays and loses non-overridden properties.', code: deepMergeCorrect.replace('isObject(out[key]) && isObject(b[key])', 'false') },
      { id: 'mutates-second-argument-only', description: 'Returns the correct result but erases b after reading it; old tests never snapshot b.', code: deepMergeCorrect.replace('return out;', 'for (const key of Object.keys(b)) delete b[key];\n  return out;') },
      { id: 'reuses-first-argument-for-empty-b', description: 'Returns a itself for an empty b; a JSON-value comparison cannot detect the identity defect.', code: deepMergeCorrect.replace('const out = copy(a);', 'if (Object.keys(b).length === 0) return a;\n  const out = copy(a);') },
    ],
    developmentCases: [
      {
        id: 'CP-L2-JS-004-dev-both-inputs-unchanged',
        calls: [[{ nested: { x: 1 }, arr: [1, 2] }, { nested: { y: 2 }, arr: [3] }]],
        expected: [{
          outcome: { kind: 'return', value: { nested: { x: 1, y: 2 }, arr: [3] } },
          argumentsAfter: [{ nested: { x: 1 }, arr: [1, 2] }, { nested: { y: 2 }, arr: [3] }],
          sameArgument: [{ index: 0, same: false }, { index: 1, same: false }],
        }],
      },
      {
        id: 'CP-L2-JS-004-dev-new-object-for-empty-b',
        calls: [[{ nested: { x: 1 } }, {}]],
        expected: [{
          outcome: { kind: 'return', value: { nested: { x: 1 } } },
          argumentsAfter: [{ nested: { x: 1 } }, {}],
          sameArgument: [{ index: 0, same: false }, { index: 1, same: false }],
        }],
      },
      {
        id: 'CP-L2-JS-004-dev-new-object-for-empty-a',
        calls: [[{}, { nested: { y: 2 } }]],
        expected: [{
          outcome: { kind: 'return', value: { nested: { y: 2 } } },
          argumentsAfter: [{}, { nested: { y: 2 } }],
          sameArgument: [{ index: 0, same: false }, { index: 1, same: false }],
        }],
      },
    ],
    notes: [
      'Object key order is compared as JSON value semantics, not the old accidental JSON.stringify string order requirement.',
      'Old hidden-2 only requires a normal return and unchanged first argument; it intentionally does not constrain the returned value or b.',
      'Old hidden-3 constrains only the arr property of the returned value; extra returned fields are not newly forbidden.',
      'Both-input immutability and fresh root identity checks are separate development cases. Nested alias independence and non-JSON object semantics are not claimed.',
    ],
  },
  'CP-L3-AW-JS-005': {
    language: 'javascript',
    contract: { protocol: 'quickjs-observation-v1', entrypoint: 'trimHistory', cases: [
      {
        id: 'CP-L3-AW-JS-005-hidden-1',
        calls: [[[
          { role: 'system', text: 's', tokens: 10 },
          { role: 'user', text: 'a', tokens: 30 },
          { role: 'user', text: 'b', tokens: 30 },
        ], 50]],
        expected: [{ outcome: { kind: 'return', valueAt: [
          { path: ['length'], value: 2 },
          { path: [0, 'role'], value: 'system' },
          { path: [1, 'text'], value: 'b' },
        ] } }],
      },
      {
        id: 'CP-L3-AW-JS-005-hidden-2',
        calls: [[[
          { role: 'system', text: 's', tokens: 100 },
          { role: 'user', text: 'a', tokens: 30 },
        ], 50]],
        expected: [{ outcome: { kind: 'return', valueAt: [
          { path: ['length'], value: 1 },
          { path: [0, 'role'], value: 'system' },
        ] } }],
      },
    ] },
    correct: trimHistoryCorrect,
    mutants: [
      {
        id: 'does-not-protect-system',
        description: 'Drops system messages like ordinary oldest messages, violating both old system-preservation points.',
        code: trimHistoryCorrect.replace("messages.findIndex(message => message.role === 'system')", '-1'),
      },
      {
        id: 'protects-first-position-not-first-system',
        description: 'Passes the old tests, where system is always index zero, but protects the wrong message when system is later or absent.',
        code: trimHistoryCorrect.replace("messages.findIndex(message => message.role === 'system')", 'messages.length > 0 ? 0 : -1'),
      },
      {
        id: 'drops-at-exact-budget',
        description: 'Uses >= instead of > and removes additional messages after the remaining sum already fits the inclusive budget.',
        code: trimHistoryCorrect.replace('total > maxTokens', 'total >= maxTokens'),
      },
    ],
    developmentCases: [
      {
        id: 'CP-L3-AW-JS-005-dev-system-in-middle',
        calls: [[[
          { role: 'user', text: 'old', tokens: 20 },
          { role: 'system', text: 'policy', tokens: 40 },
          { role: 'user', text: 'new', tokens: 10 },
        ], 50]],
        expected: [{ outcome: { kind: 'return', value: [
          { role: 'system', text: 'policy', tokens: 40 },
          { role: 'user', text: 'new', tokens: 10 },
        ] } }],
      },
      {
        id: 'CP-L3-AW-JS-005-dev-no-system',
        calls: [[[
          { role: 'user', text: 'old', tokens: 20 },
          { role: 'user', text: 'new', tokens: 30 },
        ], 30]],
        expected: [{ outcome: { kind: 'return', value: [
          { role: 'user', text: 'new', tokens: 30 },
        ] } }],
      },
      {
        id: 'CP-L3-AW-JS-005-dev-exact-budget',
        calls: [[[
          { role: 'system', text: 'policy', tokens: 10 },
          { role: 'user', text: 'keep', tokens: 20 },
        ], 30]],
        expected: [{ outcome: { kind: 'return', value: [
          { role: 'system', text: 'policy', tokens: 10 },
          { role: 'user', text: 'keep', tokens: 20 },
        ] } }],
      },
    ],
    notes: [
      'Both old cases check only return length and selected role/text properties. Preserve those exact partial assertions; do not replace them with full-array equality.',
      'The old tests do not require Array.isArray: a plain JSON object with matching length and numeric properties can pass. This known output-shape weakness is not silently repaired in the formal migration.',
      'The prompt protects the first message whose role is system, not unconditionally index zero; when no system exists, ordinary oldest-first trimming applies. The budget comparison is inclusive (sum <= maxTokens).',
      'System in a later position, no system, exact-budget retention, and complete retained message values are checked only by separate development cases, not by old scoring points.',
      'Neither formal nor development cases add input immutability, fresh-array identity, invalid-token validation, negative budgets, or multiple-system-message behavior not exercised here.',
    ],
  },
};
