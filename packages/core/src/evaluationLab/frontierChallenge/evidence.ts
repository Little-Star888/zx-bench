import { snapshotHash } from '../../contracts/pack.js';
import { exactKeys, sameSet } from '../challengeTypes.js';
import { random, integer, shuffle, makeCase, ANSWER_POLICY, popcount, bits, bitMask, type Tier } from './types.js';
export interface Constraint { id: string; members: number[]; count: number; kind: 'eq' | 'ge' | 'le' }
export interface Claim { id: string; members: number[]; threshold: number }
export interface Evidence { names: string[]; constraints: Constraint[]; claims: Claim[] }
const holds = (mask: number, c: Constraint) => { const value = c.members.reduce((s, i) => s + ((mask >>> i) & 1), 0); return c.kind === 'eq' ? value === c.count : c.kind === 'ge' ? value >= c.count : value <= c.count; };
const claimHolds = (mask: number, c: Claim) => c.members.reduce((s, i) => s + ((mask >>> i) & 1), 0) >= c.threshold;
const cache = new Map<string, number[]>();
export function worlds(p: Evidence) {
  if (p.names.length > 22) throw new Error('Evidence oracle bounds');
  const key = snapshotHash({ names: p.names, constraints: p.constraints });
  if (!cache.has(key)) {
    const compiled = p.constraints.map(c => ({ ...c, mask: c.members.reduce((s, i) => s | (1 << i), 0) })), result: number[] = [];
    for (let m = 0; m < 2 ** p.names.length; m++) if (compiled.every(c => { const v = popcount(m & c.mask); return c.kind === 'eq' ? v === c.count : c.kind === 'ge' ? v >= c.count : v <= c.count; })) result.push(m);
    if (cache.size >= 24) cache.clear(); cache.set(key, result);
  }
  return cache.get(key)!;
}
export function evidenceReference(p: Evidence) {
  const possible = worlds(p); if (!possible.length) throw new Error('Empty evidence model set');
  return { claims: p.claims.map(c => {
    const yes = possible.find(m => claimHolds(m, c)), no = possible.find(m => !claimHolds(m, c));
    return { id: c.id, status: yes === undefined ? 'refuted' : no === undefined ? 'supported' : 'insufficient',
      true_world: yes === undefined ? null : bits(yes, p.names.length), false_world: no === undefined ? null : bits(no, p.names.length) };
  }) };
}
export function gradeEvidence(p: Evidence, v: unknown) {
  if (!exactKeys(v, ['claims']) || !Array.isArray(v.claims) || !sameSet(v.claims.map(c => c?.id), p.claims.map(c => c.id)) ||
      v.claims.some(c => !exactKeys(c, ['id', 'status', 'true_world', 'false_world']))) return { valid: false, score: null, pass: false };
  const answers = v.claims, gold = evidenceReference(p), checks = gold.claims.map((g, i) => {
    const a = answers.find((x: any) => x.id === g.id), c = p.claims[i];
    const witness = (value: unknown, wanted: boolean, expected: unknown) => { if (expected === null) return value === null; const m = bitMask(value, p.names.length); return m !== null && p.constraints.every(f => holds(m, f)) && claimHolds(m, c) === wanted; };
    const status = a.status === g.status, trueWitness = witness(a.true_world, true, g.true_world), falseWitness = witness(a.false_world, false, g.false_world);
    return { id: g.id, status, trueWitness, falseWitness, pass: status && trueWitness && falseWitness };
  });
  return { valid: true, pass: checks.every(c => c.pass), score: 100 * checks.filter(c => c.pass).length / checks.length,
    diagnostics: { statusAccuracy: 100 * checks.filter(c => c.status).length / checks.length, groundedClaimAccuracy: 100 * checks.filter(c => c.pass).length / checks.length, checks } };
}
export function buildEvidence(seed: number, tier: Tier) {
  const n = [12, 16, 20][tier - 1], r = random(seed ^ (tier * 7919)), planted = integer(r, 1, 2 ** n - 2);
  const names = Array.from({ length: n }, (_, i) => `站点${integer(r, 100, 999)}${String.fromCharCode(65 + i)}`);
  const p: Evidence = { names, constraints: [], claims: [] };
  // Intersect overlapping aggregate reports until several distinct global
  // explanations remain. No individual outcome is directly disclosed.
  let candidates = Array.from({ length: 2 ** n }, (_, i) => i);
  for (let attempt = 0; attempt < 250 && candidates.length > 20; attempt++) {
    const members = shuffle(Array.from({ length: n }, (_, i) => i), integer(r, 1, 1e8)).slice(0, integer(r, 4, Math.min(9, n - 2)));
    const count = members.reduce((s, i) => s + ((planted >>> i) & 1), 0); if (!count || count === members.length) continue;
    const c: Constraint = { id: `R${integer(r, 1000, 9999)}-${p.constraints.length}`, members, count, kind: r() < .75 ? 'eq' : r() < .5 ? 'ge' : 'le' };
    const next = candidates.filter(m => holds(m, c));
    if (next.length < 4 || next.length >= candidates.length) continue;
    p.constraints.push(c); candidates = next;
  }
  if (candidates.length > 100 || candidates.length < 4) throw new Error('Evidence construction failed');
  const pool: { claim: Claim; state: string }[] = [];
  for (let attempt = 0; attempt < 600 && ['supported', 'refuted', 'insufficient'].some(s => pool.filter(x => x.state === s).length < 2); attempt++) {
    const members = shuffle(Array.from({ length: n }, (_, i) => i), integer(r, 1, 1e8)).slice(0, integer(r, 3, Math.min(7, n)));
    if (p.constraints.some(c => sameSet(c.members, members))) continue;
    const counts = candidates.map(m => members.reduce((s, i) => s + ((m >>> i) & 1), 0)), min = Math.min(...counts), max = Math.max(...counts);
    for (const threshold of [min, max + 1, min + 1]) {
      if (threshold <= 0 || threshold >= members.length) continue;
      const state = threshold <= min ? 'supported' : threshold > max ? 'refuted' : 'insufficient';
      if (pool.filter(x => x.state === state).length >= 2) continue;
      const claim = { id: `Q${integer(r, 1000, 9999)}-${pool.length}`, members, threshold };
      // No single report, including elementary subset bounds, may decide the
      // supported/refuted claims: the necessary work is evidence composition.
      const singleDecides = state !== 'insufficient' && p.constraints.some(c => {
        const overlap = c.members.filter(i => members.includes(i)).length, outside = c.members.length - overlap, free = members.length - overlap;
        const low = c.kind === 'le' ? 0 : Math.max(0, c.count - outside), high = c.kind === 'ge' ? members.length : Math.min(overlap, c.count) + free;
        return low >= threshold || high < threshold;
      });
      if (!singleDecides && !pool.some(x => x.claim.threshold === threshold && sameSet(x.claim.members, members))) pool.push({ claim, state });
    }
  }
  if (pool.length !== 6) throw new Error('Not enough composite claims');
  p.claims = shuffle(pool.map(x => x.claim), seed + tier * 41);
  const reference = evidenceReference(p);
  const docs = shuffle(p.constraints, seed + tier * 17).map((c, i) => `${c.id}｜${['汇总记录', '复核备忘', '联查摘要'][i % 3]}：${c.members.map(j => names[j]).join('、')}这${c.members.length}处中，${c.kind === 'eq' ? '恰有' : c.kind === 'ge' ? '至少有' : '至多有'}${c.count}处已通过最终验收。未提到的站点不在该统计口径内。`);
  return makeCase(seed, tier, 'hallucination_resistance', 'aggregate_evidence_entailment', p, reference,
    `以下是同一截止时刻的虚构项目资料。每个站点最终验收只有通过(1)/未通过(0)两种可能；所有记录真实、同时有效，但只披露交叠分组的总数，没有给出每站结果。不得自行补成一个唯一名单，也不得把没有直接点名误判成证据不足。\n对每条待核结论判定supported（所有符合资料的完整状态都使其成立）、refuted（所有完整状态都使其不成立）或insufficient（两类完整状态均存在）。不得根据某一个可能名单就声称结论成立。\n每条返回id,status,true_world,false_world；world为按下列站点顺序的0/1数组，且必须符合全部记录。supported给一个成立的world、false_world=null；refuted相反；insufficient必须分别给一个成立及不成立的world。返回{"claims":[...]}。${ANSWER_POLICY}\n站点顺序：${names.join('、')}\n资料：\n${docs.join('\n')}\n待核：\n${p.claims.map(c => `${c.id}：${c.members.map(i => names[i]).join('、')}中至少${c.threshold}处通过最终验收。`).join('\n')}`);
}
