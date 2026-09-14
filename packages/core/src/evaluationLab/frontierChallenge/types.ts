import { snapshotHash } from '../../contracts/pack.js';
export { random, shuffle } from '../methodsV2/types.js';
export { integer, ANSWER_POLICY } from '../structuralChallenge/types.js';
export const VERSION = 'frontier-challenge-2026-09-14-v1';
export type Tier = 1 | 2 | 3;
export type Dimension = 'reasoning_math' | 'hallucination_resistance' | 'data_extraction';
export interface Case { id: string; dimension: Dimension; tier: Tier; family: string; problem: any; reference: any;
  question: { id: string; dimension: Dimension; messages: { role: 'user'; content: string }[]; questionHash: string } }
export function makeCase(seed: number, tier: Tier, dimension: Dimension, family: string, problem: unknown, reference: unknown, prompt: string): Case {
  const id = 'FC-' + snapshotHash({ version: VERSION, seed, tier, family }).slice(0, 16);
  const q = { id, dimension, messages: [{ role: 'user' as const, content: prompt }] };
  return { id, dimension, tier, family, problem, reference, question: { ...q, questionHash: snapshotHash(q) } };
}
export function popcount(v: number) { v -= (v >>> 1) & 0x55555555; v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
export const bits = (mask: number, n: number) => Array.from({ length: n }, (_, i) => (mask >>> i) & 1);
export function bitMask(v: unknown, n: number): number | null { return Array.isArray(v) && v.length === n && v.every(x => x === 0 || x === 1) ? v.reduce((m, x, i) => m | (x << i), 0) : null; }
