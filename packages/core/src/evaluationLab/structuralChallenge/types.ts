import { snapshotHash } from '../../contracts/pack.js';
import { random, shuffle } from '../methodsV2/types.js';
export { random, shuffle };
export const STRUCTURAL_VERSION = 'structural-challenge-2026-09-14-v1';
export type Dimension = 'reasoning_math' | 'data_extraction' | 'hallucination_resistance';
export interface StructuralCase {
  id: string;
  dimension: Dimension;
  family: string;
  group: string;
  variant: string;
  problem: unknown;
  reference: unknown;
  question: { id: string; dimension: Dimension; messages: { role: 'user'; content: string }[]; questionHash: string };
}
export interface Check { id: string; pass: boolean }
export interface ContentGrade { valid: boolean; checks: Check[]; score?: number }
export function makeCase(seed: number, instance: number, dimension: Dimension, family: string,
  variant: string, problem: unknown, reference: unknown, prompt: string): StructuralCase {
  const group = snapshotHash({ version: STRUCTURAL_VERSION, seed, instance, family }).slice(0, 16);
  const id = 'SC-' + snapshotHash({ group, variant }).slice(0, 16);
  const value = { id, dimension, messages: [{ role: 'user' as const, content: prompt }] };
  return { id, dimension, family, group, variant, problem, reference,
    question: { ...value, questionHash: snapshotHash(value) } };
}
export const ANSWER_POLICY = '\n只提交所要求的答案对象。可直接输出JSON，或将唯一答案放在一个json代码块中；附加说明不参与证明评分。格式合规单列。不要输出多份候选答案，不使用外部工具。';
export function integer(r: () => number, lo: number, hi: number) { return lo + Math.floor(r() * (hi - lo + 1)); }
