import type { IsolatedJsonContract, IsolatedJsonCase } from '../execution/isolatedJson.js';
import { ISOLATED_JSON_NUMERIC_PILOTS } from './isolatedJsonNumericGold.js';
import { ISOLATED_PHP_JSON_PILOTS } from './isolatedPhpJsonGold.js';
// Development parity fixtures, NOT independently reviewed gold or held-out tests.
// Every existing hidden test ID is retained; expected values never enter Docker.
export interface IsolatedJsonFixture {
  language: string; contract: IsolatedJsonContract; correct: string; mutant: string; migrationBatch?: 2 | 3 | 4 | 5;
  developmentCases?: IsolatedJsonCase[];
}
export const ISOLATED_JSON_PILOTS: Record<string, IsolatedJsonFixture> = {
  ...ISOLATED_PHP_JSON_PILOTS,
  ...ISOLATED_JSON_NUMERIC_PILOTS,
  'CP-L2-PY-001': {
    language: 'python', migrationBatch: 3,
    contract: { protocol: 'isolated-json-v2', entrypoint: 'request', cases: [
      { id: 'CP-L2-PY-001-hidden-1', calls: [['u']], keywordArgs: [{}], expected: [30] },
      { id: 'CP-L2-PY-001-hidden-2', calls: [['u']], keywordArgs: [{ timeout: 5 }], expected: [5] },
      { id: 'CP-L2-PY-001-hidden-3', calls: [['u']], keywordArgs: [{ timeout: 0 }], expected: [0] },
    ] },
    correct: 'DEFAULT_TIMEOUT = 30\ndef request(url, timeout=None, _attempt=0):\n    effective = DEFAULT_TIMEOUT if timeout is None else timeout\n    if _attempt < 3:\n        return request(url, timeout=effective, _attempt=_attempt + 1)\n    return effective',
    mutant: 'DEFAULT_TIMEOUT = 30\ndef request(url, timeout=None, _attempt=0):\n    effective = timeout or DEFAULT_TIMEOUT\n    if _attempt < 3:\n        return request(url, timeout=effective, _attempt=_attempt + 1)\n    return effective',
  },
  'CP-L1-JS-001': {
    language: 'javascript',
    contract: { protocol: 'isolated-json-v1', entrypoint: 'sortDesc', cases: [
      { id: 'CP-L1-JS-001-hidden-1', calls: [[[3, 1, 2]]], expected: [[3, 2, 1]] },
      { id: 'CP-L1-JS-001-hidden-2', calls: [[[10, 2, 1]]], expected: [[10, 2, 1]] },
      { id: 'CP-L1-JS-001-hidden-3', calls: [[[]]], expected: [[]] },
      { id: 'CP-L1-JS-001-hidden-4', calls: [[[5, 5, 5]]], expected: [[5, 5, 5]] },
    ] },
    correct: 'function sortDesc(nums) { return nums.sort((a,b) => b-a); }',
    mutant: 'function sortDesc(nums) { return nums.sort((a,b) => a-b); }',
  },
  'CP-L1-TS-001': {
    language: 'typescript',
    contract: { protocol: 'isolated-json-v1', entrypoint: 'getCity', cases: [
      { id: 'CP-L1-TS-001-hidden-1', calls: [[{ address: { city: '北京' } }]], expected: ['北京'] },
      { id: 'CP-L1-TS-001-hidden-2', calls: [[null]], expected: ['Unknown'] },
      { id: 'CP-L1-TS-001-hidden-3', calls: [[{}]], expected: ['Unknown'] },
    ] },
    correct: "function getCity(user: {address?: {city?: string}} | null): string { return user?.address?.city ?? 'Unknown'; }",
    mutant: "function getCity(user: unknown): string { return 'wrong'; }",
  },
  'CP-L1-PY-002': {
    language: 'python',
    contract: { protocol: 'isolated-json-v1', entrypoint: 'average_positive', cases: [
      { id: 'CP-L1-PY-002-hidden-1', calls: [[[1, 2, 3]]], expected: [2] },
      { id: 'CP-L1-PY-002-hidden-2', calls: [[[-1, 2, 4]]], expected: [3] },
      { id: 'CP-L1-PY-002-hidden-3', calls: [[[]]], expected: [0] },
      { id: 'CP-L1-PY-002-hidden-4', calls: [[[-1, -2]]], expected: [0] },
    ] },
    correct: 'def average_positive(values):\n    positives = [x for x in values if x > 0]\n    return sum(positives) / len(positives) if positives else 0',
    mutant: 'def average_positive(values):\n    return sum(values) / len(values) if values else 0',
  },
  'CP-L2-TD-JS-002': {
    language: 'javascript', migrationBatch: 2,
    contract: { protocol: 'isolated-json-v1', entrypoint: 'topK', cases: [
      { id: 'CP-L2-TD-JS-002-hidden-1', calls: [[[3, 1, 2, 10, 5], 2]], expected: [[5, 10]] },
      { id: 'CP-L2-TD-JS-002-hidden-2', calls: [[[1, 2], 5]], expected: [[1, 2]] },
      { id: 'CP-L2-TD-JS-002-hidden-3', calls: [[[1, 2, 3], 0]], expected: [[]] },
    ] },
    correct: 'function topK(arr, k) { return k <= 0 ? [] : arr.sort((a,b) => a-b).slice(-k); }',
    mutant: 'function topK(arr, k) { return k <= 0 ? [] : arr.sort((a,b) => a-b).slice(0,k); }',
  },
  'CP-L2-TD-JS-003': {
    language: 'javascript', migrationBatch: 2,
    contract: { protocol: 'isolated-json-v1', entrypoint: 'slugify', cases: [
      { id: 'CP-L2-TD-JS-003-hidden-1', calls: [['Hello World']], expected: ['hello-world'] },
      { id: 'CP-L2-TD-JS-003-hidden-2', calls: [['  A  B  ']], expected: ['a-b'] },
      { id: 'CP-L2-TD-JS-003-hidden-3', calls: [['C++ & Go!']], expected: ['c-go'] },
    ] },
    correct: "function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9\\s-]/g, '').replace(/\\s+/g, '-').replace(/^-+|-+$/g, ''); }",
    mutant: "function slugify(s) { return s.toLowerCase().trim().replace(/\\s+/g, '-'); }",
  },
  'CP-L2-PY-002': {
    language: 'python', migrationBatch: 2,
    contract: { protocol: 'isolated-json-v1', entrypoint: 'parse_scores', cases: [
      { id: 'CP-L2-PY-002-hidden-1', calls: [[['1', '2', '3']]], expected: [6] },
      { id: 'CP-L2-PY-002-hidden-2', calls: [[['1', 'x', '3']]], expected: [4] },
      { id: 'CP-L2-PY-002-hidden-3', calls: [[[]]], expected: [0] },
    ] },
    correct: 'def parse_scores(lines):\n    total = 0\n    for line in lines:\n        try:\n            total += int(line)\n        except ValueError:\n            continue\n    return total',
    mutant: 'def parse_scores(lines):\n    total = 0\n    for line in lines:\n        try:\n            total = int(line)\n        except ValueError:\n            continue\n    return total',
  },
  'CP-L2-TD-PY-001': {
    language: 'python', migrationBatch: 2,
    contract: { protocol: 'isolated-json-v1', entrypoint: 'merge_intervals', cases: [
      { id: 'CP-L2-TD-PY-001-hidden-1', calls: [[[[1, 3], [2, 6], [8, 10], [15, 18]]]], expected: [[[1, 6], [8, 10], [15, 18]]] },
      { id: 'CP-L2-TD-PY-001-hidden-2', calls: [[[]]], expected: [[]] },
      { id: 'CP-L2-TD-PY-001-hidden-3', calls: [[[[1, 4], [4, 5]]]], expected: [[[1, 5]]] },
    ] },
    correct: 'def merge_intervals(intervals):\n    intervals.sort()\n    merged = []\n    for interval in intervals:\n        if merged and interval[0] <= merged[-1][1]:\n            merged[-1][1] = max(merged[-1][1], interval[1])\n        else:\n            merged.append(interval)\n    return merged',
    mutant: 'def merge_intervals(intervals):\n    intervals.sort()\n    merged = []\n    for interval in intervals:\n        if merged and interval[0] < merged[-1][1]:\n            merged[-1][1] = max(merged[-1][1], interval[1])\n        else:\n            merged.append(interval)\n    return merged',
  },
  'CP-L2-TD-PY-003': {
    language: 'python', migrationBatch: 2,
    contract: { protocol: 'isolated-json-v1', entrypoint: 'roman_to_int', cases: [
      { id: 'CP-L2-TD-PY-003-hidden-1', calls: [['III']], expected: [3] },
      { id: 'CP-L2-TD-PY-003-hidden-2', calls: [['IV'], ['IX']], expected: [4, 9] },
      { id: 'CP-L2-TD-PY-003-hidden-3', calls: [['MCMXCIV']], expected: [1994] },
    ] },
    correct: "def roman_to_int(s):\n    m = {'I':1,'V':5,'X':10,'L':50,'C':100,'D':500,'M':1000}\n    return sum(-m[c] if i+1 < len(s) and m[c] < m[s[i+1]] else m[c] for i,c in enumerate(s))",
    mutant: "def roman_to_int(s):\n    m = {'I':1,'V':5,'X':10,'L':50,'C':100,'D':500,'M':1000}\n    return sum(m[c] for c in s) - 2 * (s.count('IV') + s.count('IX'))",
  },
};
