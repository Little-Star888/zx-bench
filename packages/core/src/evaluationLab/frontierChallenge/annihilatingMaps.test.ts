import { expect, it } from 'vitest';
import { countMaps, gaussian, parseExactExpression, buildMapsProbe, gradeMaps } from './annihilatingMaps.js';
// Independent enumeration of rank-one matrices u*v^T. Normalize u's first
// nonzero coordinate to 1 so that each matrix is counted once over F_q.
function brute(n: number, q: number, intersection: number, same: boolean) {
  const vectors = Array.from({ length: q ** n - 1 }, (_, i) => { let value = i + 1; return Array.from({ length: n }, () => { const digit = value % q; value = Math.floor(value / q); return digit; }); });
  const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0) % q;
  const canonical = (v: number[]) => { const first = v.find(x => x)!; const inverse = Array.from({ length: q }, (_, i) => i).find(i => i * first % q === 1)!; return v.map(x => x * inverse % q).join(','); };
  const maps = vectors.filter(u => u.find(x => x) === 1).flatMap(u => vectors.filter(v => !dot(u, v)).map(v => ({ u, v })));
  let result = 0n;
  for (const a of maps) for (const b of maps) if (!dot(a.v, b.u) && !dot(b.v, a.u) && +(canonical(a.u) === canonical(b.u)) === intersection && (!same || canonical(a.v) === canonical(b.v))) result++;
  return result;
}
it('matches independent finite-field matrix counts, including the common-kernel constraint', () => {
  for (const [n, q] of [[3, 2], [4, 2], [3, 3]]) for (const t of [0, 1]) {
    const p = { n, q, r: 1, s: 1, intersection: t, kernels: 'unrestricted' as const }, all = brute(n, q, t, false), same = brute(n, q, t, true);
    expect(countMaps(p)).toBe(all); expect(countMaps({ ...p, kernels: 'equal' })).toBe(same); expect(countMaps({ ...p, kernels: 'different' })).toBe(all - same);
  }
  expect(gaussian(4, 2, 2)).toBe(35n);
  expect(countMaps({ n: 4, q: 2, r: 2, s: 2, intersection: 2, kernels: 'unrestricted' })).toBe(1260n);
  // Independent analytic count for quotient rows with m=4: independent b,d
  // contribute 15*14*((16-4)*4+4), dependent b,d contribute 15*14*12.
  const images = gaussian(7, 3, 2) * 7n * 3n * 2n;
  expect(countMaps({ n: 7, q: 2, r: 2, s: 2, intersection: 1, kernels: 'unrestricted', sumRank: 2 })).toBe(images * 13440n);
});
it('accepts factored exact answers and rejects code, lossy decimals and unbounded arithmetic', () => {
  expect(parseExactExpression('(2^3-1)*(2^3-2)/3')).toEqual([14n, 1n]);
  expect(parseExactExpression('-2^2')).toEqual([-4n, 1n]);
  for (const s of ['process.exit()', '2^1000000', '1/0', '1.25', '2 3', '(2^1000)^1000']) expect(parseExactExpression(s)).toBeNull();
  const p = buildMapsProbe();
  for (const c of p.cases) expect(gradeMaps(c.problem, JSON.stringify({ answer: `(${c.reference.answer})*3/3` })).contentPass).toBe(true);
  expect(p.cases[0].reference.answer).not.toBe(p.cases[1].reference.answer);
});
