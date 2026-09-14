import { snapshotHash } from '../../contracts/pack.js';
import { exactKeys, numericEqual } from '../challengeTypes.js';
import { random, integer, shuffle, makeCase, ANSWER_POLICY, popcount, bits, bitMask, type Tier } from './types.js';
export interface Optimization { n: number; bias: number[]; costs: number[]; budget: number; minSelected: number; maxSelected: number;
  edges: [number, number, number][]; parityGroups: { members: number[]; parity: number }[]; requires: [number, number][] }
export function feasible(p: Optimization, mask: number) {
  const x = bits(mask, p.n), count = popcount(mask);
  return count >= p.minSelected && count <= p.maxSelected && x.reduce((s, v, i) => s + v * p.costs[i], 0) <= p.budget &&
    p.parityGroups.every(g => g.members.reduce((s, i) => s + x[i], 0) % 2 === g.parity) && p.requires.every(([i, j]) => !x[i] || !!x[j]);
}
export function objective(p: Optimization, mask: number) {
  return p.bias.reduce((s, v, i) => s + v * ((mask >>> i) & 1), 0) + p.edges.reduce((s, [i, j, w]) => s + w * (((mask >>> i) ^ (mask >>> j)) & 1), 0);
}
const cache = new Map<string, ReturnType<typeof enumerate>>();
/** Exact full-space Gray-code enumeration. No planted optimum or LP relaxation gold. */
function enumerate(p: Optimization) {
  if (!Number.isInteger(p.n) || p.n < 2 || p.n > 26) throw new Error('Optimization oracle bounds');
  const adjacency: [number, number][][] = Array.from({ length: p.n }, () => []);
  for (const [i, j, w] of p.edges) { adjacency[i].push([j, w]); adjacency[j].push([i, w]); }
  const parityMasks = p.parityGroups.map(g => g.members.reduce((s, i) => s | (1 << i), 0));
  let mask = 0, count = 0, cost = 0, value = 0, best = -Infinity, bestMask = 0, runnerUp = -Infinity, optimumCount = 0, feasibleCount = 0;
  for (let t = 0; t < 2 ** p.n; t++) {
    if (t) {
      const bit = t & -t, j = 31 - Math.clz32(bit), old = (mask >>> j) & 1, direction = 1 - 2 * old;
      value += direction * p.bias[j]; cost += direction * p.costs[j]; count += direction;
      for (const [k, w] of adjacency[j]) value += w * (1 - 2 * (old ^ ((mask >>> k) & 1)));
      mask ^= bit;
    }
    if (count < p.minSelected || count > p.maxSelected || cost > p.budget) continue;
    if (parityMasks.some((m, i) => (popcount(m & mask) & 1) !== p.parityGroups[i].parity)) continue;
    if (p.requires.some(([i, j]) => ((mask >>> i) & 1) && !((mask >>> j) & 1))) continue;
    feasibleCount++;
    if (value > best) { runnerUp = best; best = value; bestMask = mask; optimumCount = 1; }
    else if (value === best) optimumCount++;
    else if (value > runnerUp) runnerUp = value;
  }
  if (!feasibleCount) throw new Error('Infeasible generated optimization');
  return { value: best, x: bits(bestMask, p.n), feasibleCount, optimumCount, secondBest: Number.isFinite(runnerUp) ? runnerUp : null };
}
export function solveOptimization(p: Optimization) {
  const key = snapshotHash(p); if (!cache.has(key)) { if (cache.size >= 24) cache.clear(); cache.set(key, enumerate(p)); } return structuredClone(cache.get(key)!);
}
export function gradeOptimization(p: Optimization, v: unknown) {
  if (!exactKeys(v, ['value', 'x'])) return { valid: false, score: null, pass: false };
  const mask = bitMask(v.x, p.n), gold = solveOptimization(p), witnessFeasible = mask !== null && feasible(p, mask);
  const actual = mask === null ? null : objective(p, mask), valueConsistent = actual !== null && numericEqual(v.value, actual);
  const pass = witnessFeasible && valueConsistent && actual === gold.value;
  return { valid: mask !== null, pass, score: mask === null ? null : pass ? 100 : 0,
    diagnostics: { witnessFeasible, valueConsistent, claimedObjective: v.value, witnessObjective: actual, optimum: gold.value,
      optimalityGap: witnessFeasible ? gold.value - actual! : null, normalizedGap: witnessFeasible ? (gold.value - actual!) / Math.max(1, Math.abs(gold.value)) : null,
      note: 'A feasible near-optimum is reported separately; it is not a proved global optimum.' } };
}
export function buildOptimization(seed: number, tier: Tier) {
  const n = [16, 22, 26][tier - 1], r = random(seed ^ (tier * 65537));
  const planted = shuffle(Array.from({ length: n }, (_, i) => i), seed + tier).slice(0, Math.floor(n / 2));
  const mask = planted.reduce((s, i) => s | (1 << i), 0), x = bits(mask, n);
  const p: Optimization = { n, bias: Array.from({ length: n }, () => integer(r, -12, 18)), costs: Array.from({ length: n }, () => integer(r, 2, 17)),
    budget: 0, minSelected: Math.floor(n / 2) - 1, maxSelected: Math.floor(n / 2) + 1, edges: [], parityGroups: [], requires: [] };
  p.budget = x.reduce((s, v, i) => s + v * p.costs[i], 0) + integer(r, 0, 9);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (r() < 0.43) p.edges.push([i, j, integer(r, -9, 24)]);
  for (let g = 0; g < tier + 1; g++) {
    const members = shuffle(Array.from({ length: n }, (_, i) => i), integer(r, 1, 1e8)).slice(0, integer(r, 4, 7));
    p.parityGroups.push({ members, parity: members.reduce((s, i) => s + x[i], 0) % 2 });
  }
  while (p.requires.length < tier + 1) { const i = integer(r, 0, n - 1), j = integer(r, 0, n - 1); if (i !== j && (!x[i] || x[j]) && !p.requires.some(a => a[0] === i && a[1] === j)) p.requires.push([i, j]); }
  const oracle = solveOptimization(p), reference = { value: oracle.value, x: oracle.x };
  return makeCase(seed, tier, 'reasoning_math', 'constrained_quadratic_global_optimum', p, reference,
    `求下列0/1整数优化的全局最大值和一个达到该值的解。变量编号从0开始。目标为 Σ bias[i]·x[i] + Σ edges中的w·(x[i] XOR x[j])。边表每行[i,j,w]只计一次，权重可能为负。约束：所选个数在[minSelected,maxSelected]内；Σcosts[i]·x[i]≤budget；每个parityGroups组的所选个数模2等于parity；每条requires=[i,j]要求x[i]≤x[j]。连续松弛、贪心解或只满足部分约束不等于全局最优。返回{"value":整数最大值,"x":[按变量顺序的0或1]}。${ANSWER_POLICY}\n数据：${JSON.stringify(p)}`);
}
