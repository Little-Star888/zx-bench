/** A separate insight-led probe: not part of the already frozen frontier pack. */
import { exactKeys, rational, add, mul, div, neg, type Rational } from '../challengeTypes.js';
import { extractStructuralAnswer } from '../structuralChallenge/index.js';
import { snapshotHash } from '../../contracts/pack.js';
export interface MapsProblem { n: number; q: number; r: number; s: number; intersection: number; kernels: 'unrestricted' | 'equal' | 'different'; sumRank?: number }
export function gaussian(n: number, k: number, q: number): bigint {
  if (k < 0 || k > n) return 0n;
  let numerator = 1n, denominator = 1n;
  for (let i = 0; i < k; i++) { numerator *= BigInt(q) ** BigInt(n - i) - 1n; denominator *= BigInt(q) ** BigInt(k - i) - 1n; }
  if (numerator % denominator) throw new Error('Nonintegral Gaussian coefficient'); return numerator / denominator;
}
const surjections = (domain: number, rank: number, q: number) => {
  if (rank > domain || domain < 0) return 0n;
  let result = 1n; for (let i = 0; i < rank; i++) result *= BigInt(q) ** BigInt(domain) - BigInt(q) ** BigInt(i); return result;
};
export function countMaps(p: MapsProblem) {
  if (![2, 3, 5, 7, 11, 13].includes(p.q) || ![p.n, p.r, p.s, p.intersection].every(Number.isInteger) || p.n < 1 || p.n > 14 || Math.min(p.r, p.s, p.intersection) < 0) throw new Error('Map oracle bounds');
  const { n, q, r, s, intersection: t } = p, d = r + s - t, m = n - d;
  if (t > Math.min(r, s) || d > n || Math.max(r, s) > m) return 0n;
  // W=im(A)+im(B), dim W=d, is annihilated by both maps.
  // Choose W, then its ordered image pair U,V; maps factor independently
  // through F_q^n/W and are onto U,V. Equal kernels replace two independent
  // kernel choices with one common kernel choice (only possible if r=s).
  const images = gaussian(n, d, q) * gaussian(d, r, q) * gaussian(r, t, q) * BigInt(q) ** BigInt((r - t) * (s - t));
  if (p.sumRank !== undefined) {
    // For U=<e1,e2>, V=<e1,e3>, write A's nonzero rows as (a,b)
    // and B's as (c,d). A+B has rows (a+c,b,d). Enumerate only
    // these quotient maps, NOT the original pair of n by n matrices.
    if (q !== 2 || r !== 2 || s !== 2 || t !== 1 || m > 4 || !Number.isInteger(p.sumRank)) throw new Error('Sum-rank oracle bounds');
    const rank = (rows: number[]) => { const basis: number[] = []; for (let v of rows) { for (const b of basis) v = Math.min(v, v ^ b); if (v) { basis.push(v); basis.sort((a, b) => b - a); } } return basis.length; };
    let count = 0n; const size = 2 ** m;
    for (let b = 1; b < size; b++) for (let a = 1; a < size; a++) if (a !== b)
      for (let d = 1; d < size; d++) for (let c = 1; c < size; c++) if (c !== d && rank([a ^ c, b, d]) === p.sumRank) {
        const same = rank([a, b, c, d]) === 2;
        if (p.kernels === 'unrestricted' || (p.kernels === 'equal' ? same : !same)) count++;
      }
    return images * count;
  }
  const all = surjections(m, r, q) * surjections(m, s, q);
  const same = r === s ? gaussian(m, r, q) * surjections(r, r, q) ** 2n : 0n;
  return images * (p.kernels === 'equal' ? same : p.kernels === 'different' ? all - same : all);
}

/** Bounded exact arithmetic only: never eval, Python, or SymPy on model text. */
export function parseExactExpression(value: unknown): Rational | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const source = String(value).replaceAll('**', '^');
  if (source.length > 6000 || /[^0-9\s+*/^()\-]/.test(source)) return null;
  const tokens = source.match(/\d+|[+*/^()\-]/g) ?? []; if (!tokens.length || tokens.length > 2000) return null;
  let at = 0, depth = 0;
  const bounded = (v: Rational) => { if (v[0].toString(2).length > 32768 || v[1].toString(2).length > 32768) throw new Error('Arithmetic bounds'); return v; };
  const atom = (): Rational => {
    if (++depth > 64) throw new Error('Nesting bound');
    let value: Rational;
    if (tokens[at] === '(') { at++; value = sum(); if (tokens[at++] !== ')') throw new Error('Missing close'); }
    else { const token = tokens[at++]; if (!token || !/^\d+$/.test(token) || token.length > 100) throw new Error('Expected integer'); value = rational(BigInt(token)); }
    depth--; return value;
  };
  const power = (): Rational => { let v = atom(); if (tokens[at] === '^') { at++; const e = unary();
    if (e[1] !== 1n || e[0] < 0n || e[0] > 1000n || BigInt(Math.max(v[0].toString(2).length, v[1].toString(2).length)) * e[0] > 32768n) throw new Error('Power bound');
    v = bounded(rational(v[0] ** e[0], v[1] ** e[0])); } return v; };
  const unary = (): Rational => { if (tokens[at] === '-') { at++; return neg(unary()); } if (tokens[at] === '+') { at++; return unary(); } return power(); };
  const product = (): Rational => { let v = unary(); while (tokens[at] === '*' || tokens[at] === '/') { const op = tokens[at++], b = unary(); v = bounded(op === '*' ? mul(v, b) : div(v, b)); } return v; };
  const sum = (): Rational => { let v = product(); while (tokens[at] === '+' || tokens[at] === '-') { const op = tokens[at++], b = product(); v = bounded(add(v, op === '+' ? b : neg(b))); } return v; };
  try { const v = sum(); return at === tokens.length ? v : null; } catch { return null; }
}
export function gradeMaps(p: MapsProblem, output: string) {
  const parsed = extractStructuralAnswer(output), a = parsed.answer;
  if (!exactKeys(a, ['answer'])) return { measured: false, contentPass: null, contentScore: null, formatCompliant: false };
  const value = parseExactExpression(a.answer), pass = !!value && value[1] === 1n && value[0] === countMaps(p);
  return { measured: !!value, contentPass: value ? pass : null, contentScore: value ? pass ? 100 : 0 : null, formatCompliant: !!value && parsed.formatCompliant };
}
export function buildMapsProbe() {
  const version = 'annihilating-maps-2026-09-14-v1';
  const problems: MapsProblem[] = [
    { n: 7, q: 2, r: 2, s: 2, intersection: 0, kernels: 'unrestricted' },
    { n: 7, q: 2, r: 2, s: 2, intersection: 0, kernels: 'equal' },
    { n: 7, q: 2, r: 2, s: 2, intersection: 1, kernels: 'unrestricted', sumRank: 2 },
  ];
  const cases = problems.map(problem => {
    const id = 'AM-' + snapshotHash({ version, problem }).slice(0, 16);
    const condition = (problem.kernels === 'equal' ? '另外要求ker(A)=ker(B)。' : '不要求ker(A)与ker(B)相同，也不要求它们不同。') + (problem.sumRank === undefined ? '' : `另外要求rank(A+B)=${problem.sumRank}。`);
    const prompt = `设V是有限域F_${problem.q}上的${problem.n}维向量空间。求有序线性算子对(A,B)的个数，满足A²=B²=AB=BA=0，rank(A)=${problem.r}，rank(B)=${problem.s}，dim(im(A)∩im(B))=${problem.intersection}。${condition}\n不同线性映射算作不同对象，不按换基或共轭取商。返回JSON {"answer":精确答案字符串}。字符串可为整数，也可为只含整数、括号、+ - * / ^的精确算术表达式（^表示乘方，指数为0至1000的整数），无需展开大整数乘积，不接受近似小数、未定义函数或伪代码。只输出唯一答案，可放在一个JSON代码块中。附加说明不参与答案评分，不使用外部工具。`;
    const q = { id, dimension: 'reasoning_math' as const, messages: [{ role: 'user' as const, content: prompt }] };
    return { id, problem, reference: { answer: countMaps(problem).toString() }, question: { ...q, questionHash: snapshotHash(q) } };
  });
  const policy = { version, candidateOnly: true, productionEligible: false, tools: false, exactArithmeticExpressionsAllowed: true, hypothesis: 'subspace_and_quotient_reasoning_not_exhaustive_assignment_search' };
  return { policy, cases, questions: cases.map(c => c.question), contractHash: snapshotHash({ policy, cases }) };
}
export type MapsPack = ReturnType<typeof buildMapsProbe>;
export function assertMapsPack(pack: MapsPack) { if (snapshotHash(pack) !== snapshotHash(buildMapsProbe())) throw new Error('Frozen maps pack mismatch'); }
export function scoreMaps(pack: MapsPack, input: import('./index.js').Submission) {
  assertMapsPack(pack);
  if (input.contractHash !== pack.contractHash || [input.runId, input.modelId, input.modelFamily].some(v => typeof v !== 'string' || !v.trim()) || !Array.isArray(input.answers)) throw new Error('Invalid submission');
  const seen = new Set<string>();
  for (const a of input.answers) {
    if (!exactKeys(a, ['id', 'questionHash', 'outcome', 'output']) || seen.has(a.id) || !pack.questions.some(q => q.id === a.id && q.questionHash === a.questionHash) || typeof a.output !== 'string' || !['completed', 'timeout', 'truncated', 'environment_error'].includes(a.outcome)) throw new Error('Duplicate/unknown/stale answer'); seen.add(a.id);
  }
  const rows = pack.cases.map(c => { const a = input.answers.find(a => a.id === c.id); return { id: c.id, dimension: 'reasoning_math', family: 'annihilating_maps', problem: c.problem, state: a?.outcome ?? 'missing', ...(a?.outcome === 'completed' ? gradeMaps(c.problem, a.output) : {}) }; });
  return { version: pack.policy.version, contractHash: pack.contractHash, modelId: input.modelId, modelFamily: input.modelFamily, runId: input.runId, rows,
    dimensions: [{ dimension: 'reasoning_math', planned: rows.length, measured: rows.filter(r => r.measured).length,
      deliveredScore: rows.some(r => ['missing', 'environment_error'].includes(r.state)) ? null : rows.reduce((s, r) => s + (r.contentScore ?? 0), 0) / rows.length,
      contentOnlyScore: rows.every(r => r.measured) ? rows.reduce((s, r) => s + r.contentScore!, 0) / rows.length : null }], productionEligible: false, difficultyCalibrated: false };
}
