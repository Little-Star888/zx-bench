import { add, div, mul, rational, fraction, numericEqual, exactKeys, parseRational, type Rational } from '../challengeTypes.js';
import { verifyLinearOptimization, type LinearOptimization } from '../linearOptimizationCertificate.js';
import { ANSWER_POLICY, integer, makeCase, random, shuffle, type StructuralCase, type ContentGrade } from './types.js';
const q = (n: number, d = 1) => rational(BigInt(n), BigInt(d));
const asString = (x: Rational) => fraction(x[0], x[1]);
const less = (a: Rational, b: Rational) => a[0] * b[1] < b[0] * a[1];

export interface SamplingProblem {
  boxes: number[][]; prior: number[]; cap: number; stopColor: number; stopCount: number;
  observedColor: number; nextColor: number; mechanism: 'experiment_then_record' | 'pooled_records';
}
/** Exact enumeration of bounded paths; terminal length changes the sampling measure. */
export function samplingReference(p: SamplingProblem) {
  const totals = Array.from({ length: 5 }, () => q(0));
  const priorTotal = p.prior.reduce((s, x) => s + x, 0);
  for (let box = 0; box < p.boxes.length; box++) {
    const visit = (left: number[], seen: number[], mass: Rational) => {
      const t = seen.reduce((s, x) => s + x, 0);
      if (t === p.cap || seen[p.stopColor] === p.stopCount) {
        // Sampling a pooled record weights each terminal experiment by its length.
        totals[0] = add(totals[0], mul(mass, q(p.mechanism === 'pooled_records' ? t : 1)));
        const observed = mul(mass, q(seen[p.observedColor], p.mechanism === 'pooled_records' ? 1 : t));
        totals[1] = add(totals[1], observed);
        if (box === 0) totals[2] = add(totals[2], observed);
        totals[3] = add(totals[3], mul(observed, q(t)));
        totals[4] = add(totals[4], mul(observed, q(left[p.nextColor], left.reduce((s, x) => s + x, 0))));
        return;
      }
      const n = left.reduce((s, x) => s + x, 0);
      left.forEach((count, color) => {
        if (!count) return;
        const next = [...left], drawn = [...seen]; next[color]--; drawn[color]++;
        visit(next, drawn, mul(mass, q(count, n)));
      });
    };
    visit([...p.boxes[box]], [0, 0, 0], q(p.prior[box], priorTotal));
  }
  if (totals[1][0] === 0n) throw new Error('Impossible observed color');
  return { observation_probability: asString(div(totals[1], totals[0])),
    posterior_box0: asString(div(totals[2], totals[1])), expected_length: asString(div(totals[3], totals[1])),
    next_color_probability: asString(div(totals[4], totals[1])) };
}
export function buildSampling(seed: number, instance: number): StructuralCase[] {
  const r = random(seed ^ Math.imul(instance + 1, 7919));
  const base = { boxes: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => integer(r, 2, 5))),
    prior: Array.from({ length: 3 }, () => integer(r, 1, 6)), cap: integer(r, 3, 5), stopColor: integer(r, 0, 2),
    stopCount: integer(r, 1, 2), observedColor: integer(r, 0, 2), nextColor: integer(r, 0, 2) };
  return (['experiment_then_record', 'pooled_records'] as const).map(mechanism => {
    const problem = { ...base, mechanism };
    const sampling = mechanism === 'experiment_then_record'
      ? '先独立执行一次实验，再在这次实验的全部抽球记录中等概率选一条。'
      : '独立重复实验N次，把全部抽球记录合并，再在合并后的记录中等概率选一条；求N趋向无穷时的概率。';
    const prompt = `颜色编号0/1/2。先按prior的相对权重选一个盒子，全程不换盒。每次从同盒不放回抽球；累计抽到stopCount个stopColor，或抽取次数达到cap，立即停止。每抽一球产生一条颜色记录。\n${sampling}\n只观察到被选记录的颜色为observedColor，不知道该实验选盒、长度T或其他记录。随后从产生这条记录的那次实验结束时的剩余同盒中再抽一球。\n求 observation_probability（被选记录符合观测的概率）、posterior_box0（给定观测来自盒0的概率）、expected_length（给定观测的实验长度期望）、next_color_probability（给定观测随后抽到nextColor的概率）。四项用精确分数字符串或整数。${ANSWER_POLICY}\n数据：${JSON.stringify(base)}`;
    return makeCase(seed, instance, 'reasoning_math', 'sampling_measure', mechanism, problem, samplingReference(problem), prompt);
  });
}

export interface IdentificationProblem { prior: number[]; feature: number[]; featureDenominator: number;
  gateDenominator: number; reportProbability: string; featureGivenReport: string }
function mechanisms(p: IdentificationProblem) {
  const out: { gate: number[]; posterior: string }[] = [], sum = p.prior.reduce((s, x) => s + x, 0), d = p.gateDenominator;
  for (let a = 0; a <= d; a++) for (let b = 0; b <= d; b++) for (let c = 0; c <= d; c++) {
    const gate = [a, b, c], mass = gate.reduce((s, x, i) => s + x * p.prior[i], 0);
    if (!mass || !numericEqual(fraction(mass, sum * d), p.reportProbability)) continue;
    const feature = gate.reduce((s, x, i) => s + x * p.prior[i] * p.feature[i], 0);
    if (numericEqual(fraction(feature, mass * p.featureDenominator), p.featureGivenReport))
      out.push({ gate, posterior: fraction(a * p.prior[0], mass) });
  }
  return out;
}
export function identificationReference(p: IdentificationProblem) {
  const feasible = mechanisms(p).sort((a, b) => less(parseRational(a.posterior)!, parseRational(b.posterior)!) ? -1 : less(parseRational(b.posterior)!, parseRational(a.posterior)!) ? 1 : 0);
  if (!feasible.length) return { status: 'inconsistent', lower: null, upper: null, lower_gate: null, upper_gate: null };
  const low = feasible[0], high = feasible[feasible.length - 1];
  return { status: numericEqual(low.posterior, high.posterior) ? 'identified' : 'bounded', lower: low.posterior, upper: high.posterior,
    lower_gate: low.gate, upper_gate: high.gate };
}
export function verifyIdentification(p: IdentificationProblem, v: unknown): ContentGrade {
  if (!exactKeys(v, ['status', 'lower', 'upper', 'lower_gate', 'upper_gate'])) return { valid: false, checks: [] };
  const gold = identificationReference(p), feasible = mechanisms(p);
  const checks = [{ id: 'identification_status', pass: v.status === gold.status }];
  for (const end of ['lower', 'upper'] as const) {
    checks.push({ id: end, pass: gold[end] === null ? v[end] === null : numericEqual(v[end], gold[end]) });
    checks.push({ id: `${end}_witness`, pass: gold[end] === null ? v[`${end}_gate`] === null
      : feasible.some(m => JSON.stringify(m.gate) === JSON.stringify(v[`${end}_gate`]) && numericEqual(m.posterior, v[end])) });
  }
  return { valid: true, checks };
}
export function buildIdentification(seed: number, instance: number): StructuralCase[] {
  const r = random(seed ^ Math.imul(instance + 1, 3571)), denominator = integer(r, 3, 6);
  // All states share grid size, row count, field names and prompt. Search a small
  // exact grid for observations with different identification states.
  const start = integer(r, 1, 3), step = integer(r, 1, 3);
  const order = shuffle([0, 1, 2], integer(r, 1, 1e8));
  // This lattice admits both unique and non-unique posteriors without a
  // state-specific fallback (such as constant features only for bounded cases).
  const base = { prior: order.map(i => [1, 2, 1][i]),
    feature: order.map(i => start + i * step), featureDenominator: 10, gateDenominator: denominator };
  const sum = base.prior.reduce((s, x) => s + x, 0), buckets = new Map<string, IdentificationProblem>();
  for (let a = 0; a <= denominator; a++) for (let b = 0; b <= denominator; b++) for (let c = 0; c <= denominator; c++) {
    const g = [a, b, c], mass = g.reduce((s, x, i) => s + x * base.prior[i], 0); if (!mass) continue;
    const p = { ...base, reportProbability: fraction(mass, sum * denominator), featureGivenReport: fraction(g.reduce((s, x, i) => s + x * base.prior[i] * base.feature[i], 0), mass * 10) };
    buckets.set(`${p.reportProbability}:${p.featureGivenReport}`, p);
  }
  const choices = shuffle([...buckets.values()], seed + instance * 79), selected = new Map<string, IdentificationProblem>();
  for (const p of choices) { const state = identificationReference(p).status; if (!selected.has(state)) selected.set(state, p); if (selected.size === 2) break; }
  if (selected.size !== 2) throw new Error('Missing identification state');
  const anchor = choices[0];
  // Both marginals occur in genuine experiments; their combination does not.
  // An out-of-range probability or a special denominator would reveal status.
  const other = choices.find(p => !buckets.has(`${anchor.reportProbability}:${p.featureGivenReport}`));
  if (!other) throw new Error('Missing inconsistent observation pair');
  selected.set('inconsistent', { ...anchor, featureGivenReport: other.featureGivenReport });
  return [...selected].map(([variant, problem]) => {
    const prompt = `有三个来源0/1/2，来源选择概率为prior的相对权重。来自来源i的样本具有特征F的概率为feature[i]/featureDenominator。来源i以未知概率r_i发出报告；给定来源后，报告与F独立。已知每个r_i只能取0,1/D,...,1，D=gateDenominator。\n记录给出精确总体量P(报告)=reportProbability，以及P(F|报告)=featureGivenReport。求P(来源0|报告)是否唯一确定；不唯一时求可达的最小和最大值，数据矛盾时明确指出。不要假设三个来源报告概率相同。\n返回同一结构：status为identified/bounded/inconsistent；lower、upper为精确分数，lower_gate、upper_gate为达到端点的三个整数分子（共同分母D）。唯一确定时两端相等，证书可以相同；矛盾时四个字段均为null。${ANSWER_POLICY}\n数据：${JSON.stringify(problem)}`;
    return makeCase(seed, instance, 'reasoning_math', 'latent_identification', variant, problem, identificationReference(problem), prompt);
  });
}

export function buildOptimization(seed: number, instance: number): StructuralCase[] {
  const r = random(seed ^ Math.imul(instance + 1, 65537)), n = 4, m = 8;
  const signed = () => integer(r, -5, 5), positive = () => integer(r, 1, 4), dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
  return (['optimal', 'infeasible', 'unbounded'] as const).map(status => {
    let a: number[][], b: number[], c: number[], reference: Record<string, unknown>;
    if (status === 'optimal') {
      const x = Array.from({ length: n }, positive), y = [positive(), 0, positive(), 0, positive(), 0, 0, 0];
      a = Array.from({ length: m }, () => Array.from({ length: n }, signed));
      b = a.map((row, i) => dot(row, x) + (y[i] ? 0 : positive()));
      c = Array.from({ length: n }, (_, j) => a.reduce((s, row, i) => s + row[j] * y[i], 0));
      reference = { status, x, y, value: dot(c, x) };
    } else if (status === 'infeasible') {
      a = Array.from({ length: m - 1 }, () => Array.from({ length: n }, signed)); b = Array.from({ length: m - 1 }, signed);
      const y = Array.from({ length: m - 1 }, positive);
      a.push(Array.from({ length: n }, (_, j) => -a.reduce((s, row, i) => s + row[j] * y[i], 0) + integer(r, 0, 2)));
      b.push(-dot(b, y) - positive()); y.push(1); c = Array.from({ length: n }, signed); reference = { status, y };
    } else {
      const ray = [positive(), positive(), positive(), 1], x = Array.from({ length: n }, positive);
      a = Array.from({ length: m }, () => { const row = Array.from({ length: n - 1 }, signed); return [...row, -dot(row, ray) - integer(r, 0, 3)]; });
      b = a.map(row => dot(row, x) + integer(r, 0, 3)); c = Array.from({ length: n }, positive); reference = { status, x, ray };
    }
    const columns = shuffle([0, 1, 2, 3], integer(r, 1, 1e8)), rows = shuffle(Array.from({ length: m }, (_, i) => i), integer(r, 1, 1e8));
    const problem: LinearOptimization = { a: rows.map(i => columns.map(j => a[i][j])), b: rows.map(i => b[i]), c: columns.map(j => c[j]) };
    if (Array.isArray(reference.x)) reference.x = columns.map(j => (reference.x as number[])[j]);
    if (Array.isArray(reference.ray)) reference.ray = columns.map(j => (reference.ray as number[])[j]);
    if (Array.isArray(reference.y)) reference.y = rows.map(i => (reference.y as number[])[i]);
    if (!verifyLinearOptimization(problem, reference).pass) throw new Error('Invalid generated optimization witness');
    const prompt = `实数线性规划：最大化c·x，Ax≤b，x≥0。自行判定有限最优、不可行或无界，并提交任意有效证书。\n有限最优：{"status":"optimal","x":[可行点],"y":[非负对偶向量],"value":值}，要求Aᵀy≥c，c·x=b·y=value。\n不可行：{"status":"infeasible","y":[非负向量]}，要求Aᵀy≥0且b·y<0。\n无界：{"status":"unbounded","x":[可行点],"ray":[非负方向]}，要求A·ray≤0且c·ray>0。所有数值为整数或精确分数。${ANSWER_POLICY}\n数据：${JSON.stringify(problem)}`;
    return makeCase(seed, instance, 'reasoning_math', 'optimization_status', status, problem, reference, prompt);
  });
}
