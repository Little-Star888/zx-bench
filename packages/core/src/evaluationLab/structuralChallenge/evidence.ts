import { exactKeys, sameSet } from '../challengeTypes.js';
import { ANSWER_POLICY, integer, makeCase, random, shuffle, type ContentGrade } from './types.js';
interface Scope { product: string; version: string; population: string; metric: string; period: string }
interface Fact { id: string; scope: Scope; value: boolean; status: 'final' | 'draft'; supersedes: string | null }
interface Claim { id: string; scope: Scope; value: boolean }
export interface EvidenceProblem { facts: Fact[]; claims: Claim[]; aliases: { id: string; alias: string; product: string; version: string }[] }
const scopeEqual = (a: Scope, b: Scope) => Object.keys(a).every(k => a[k as keyof Scope] === b[k as keyof Scope]);
export function evidenceReference(p: EvidenceProblem) {
  const replaced = new Set(p.facts.filter(f => f.status === 'final').map(f => f.supersedes).filter(Boolean));
  const live = p.facts.filter(f => f.status === 'final' && !replaced.has(f.id));
  return { claims: p.claims.map(c => {
    const alias = p.aliases.find(a => a.alias === c.scope.product && a.version === c.scope.version);
    const scope = { ...c.scope, product: alias?.product ?? c.scope.product };
    const relevant = live.filter(f => scopeEqual(scope, f.scope));
    const support = relevant.filter(f => f.value === c.value), refute = relevant.filter(f => f.value !== c.value);
    const status = support.length && refute.length ? 'conflict' : support.length ? 'supported' : refute.length ? 'refuted' : 'insufficient';
    const sources = [...relevant.map(f => f.id), ...(alias && relevant.length ? [alias.id] : [])];
    return { id: c.id, status, sources: sources.sort() };
  }) };
}
export function verifyEvidence(p: EvidenceProblem, v: unknown): ContentGrade {
  if (!exactKeys(v, ['claims']) || !Array.isArray(v.claims) || v.claims.length !== p.claims.length ||
    v.claims.some(c => !exactKeys(c, ['id', 'status', 'sources'])) || !sameSet(v.claims.map(c => c.id), p.claims.map(c => c.id))) return { valid: false, checks: [] };
  const gold = evidenceReference(p), checks: { id: string; pass: boolean }[] = [];
  for (const expected of gold.claims) {
    const actual = v.claims.find(c => c.id === expected.id)!;
    checks.push({ id: `${expected.id}:status`, pass: actual.status === expected.status });
    // Citation scope is explicitly all active matching evidence, not an arbitrary
    // gold-only whitelist; include both sides of a conflict and identity links.
    checks.push({ id: `${expected.id}:evidence`, pass: sameSet(actual.sources, expected.sources) });
  }
  const correctClaims = gold.claims.filter(c => checks.filter(k => k.id.startsWith(`${c.id}:`)).every(k => k.pass)).length;
  return { valid: true, checks, score: 100 * correctClaims / gold.claims.length };
}
export function buildEvidence(seed: number, instance: number) {
  const r = random(seed ^ Math.imul(instance + 1, 9743)), token = () => integer(r, 1000, 9999);
  const product = `系统${token()}`, other = `系统${token()}B`, alias = `代号${token()}`;
  const base: Scope = { product, version: `v${integer(r, 2, 9)}`, population: '华东企业用户', metric: '错误率低于对照组', period: `2026-${integer(r, 1, 8).toString().padStart(2, '0')}` };
  const id = (i: number) => `D${token()}${i}`;
  const facts: Fact[] = [
    { id: id(0), scope: { ...base }, value: true, status: 'final', supersedes: null },
    { id: id(1), scope: { ...base, population: '华北企业用户' }, value: false, status: 'final', supersedes: null },
    { id: id(2), scope: { ...base, product: other }, value: false, status: 'final', supersedes: null },
    { id: id(3), scope: { ...base, metric: '响应时间低于对照组' }, value: true, status: 'final', supersedes: null },
    { id: id(4), scope: { ...base }, value: false, status: 'draft', supersedes: null },
    { id: id(5), scope: { ...base, population: '华北企业用户' }, value: true, status: 'final', supersedes: null },
    { id: id(6), scope: { ...base, version: 'v0' }, value: false, status: 'final', supersedes: null },
  ];
  const aliasDoc = { id: id(7), alias, product, version: base.version };
  const claims: Claim[] = [
    { id: `C${token()}0`, scope: { ...base, product: alias }, value: true },
    { id: `C${token()}1`, scope: { ...base, product: alias }, value: false },
    { id: `C${token()}2`, scope: { ...base, population: '华北企业用户' }, value: true },
    { id: `C${token()}3`, scope: { ...base, population: '全国全部用户' }, value: true },
    { id: `C${token()}4`, scope: { ...base, metric: '响应时间低于对照组' }, value: true },
    { id: `C${token()}5`, scope: { ...base, period: '2027-01' }, value: true },
  ];
  const describe = (s: Scope, value: boolean) => `${s.product} ${s.version}，${s.period}，${s.population}：${s.metric}——${value ? '成立' : '不成立'}`;
  return ['draft_correction', 'final_correction', 'other_identity', 'reordered'].map(variant => {
    const fs = structuredClone(facts), aliases = [structuredClone(aliasDoc)];
    fs[4].supersedes = fs[0].id;
    if (variant === 'final_correction') fs[4].status = 'final';
    if (variant === 'other_identity') aliases[0].product = other;
    const problem: EvidenceProblem = { facts: shuffle(fs, seed + instance + (variant === 'reordered' ? 871 : 17)),
      claims: shuffle(claims, seed + instance + 31), aliases };
    const docs = [...problem.facts.map(f => `${f.id}（${f.status === 'final' ? '正式报告' : '未批准草稿'}${f.supersedes ? `；全文替代${f.supersedes}` : ''}）：${describe(f.scope, f.value)}。`),
      ...aliases.map(a => `${a.id}（身份登记）：${a.alias}在${a.version}对应${a.product}；不适用于其他版本。`)];
    const prompt = `以下为虚构资料包，评估每个待核结论在当前材料中是否有充分依据，不调用外部事实。正式替代报告使指定旧报告整体失效；未批准草稿不产生替代效力，也不作为结论依据。没有替代关系的正式报告同等权威。产品/版本/人群/指标/时间范围均不可擅自外推，身份登记只在指定版本有效。\n对每条结论输出supported/refuted/insufficient/conflict：分别表示有效材料支持、有效材料否定、有效材料无法判断、同等有效材料同时支持与否定。不能把信息不足等同于否定。\n返回 {"claims":[{"id":结论ID,"status":状态,"sources":[材料ID]}]}。sources列出所有仍有效且范围匹配的直接证据，涉及代号换名时加上必要身份登记；冲突须列双方，信息不足返回空数组。草稿、已被替代或范围不匹配的材料不列入。结论顺序不限。${ANSWER_POLICY}\n材料：\n${docs.join('\n')}\n待核结论：\n${problem.claims.map(c => `${c.id}：${describe(c.scope, c.value)}。`).join('\n')}`;
    return makeCase(seed, instance, 'hallucination_resistance', 'scoped_evidence_revision', variant, problem, evidenceReference(problem), prompt);
  });
}
