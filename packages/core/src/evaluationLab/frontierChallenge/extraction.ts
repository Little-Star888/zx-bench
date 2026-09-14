import { exactKeys, object, equal } from '../challengeTypes.js';
import { random, integer, shuffle, makeCase, ANSWER_POLICY, type Tier } from './types.js';
export interface RecordValue { entity_id: string; label: string; quantity: number; due_date: string | null; owner: string | null }
type Values = Partial<Omit<RecordValue, 'entity_id'>>;
type Operation = { kind: 'put'; values: Values } | { kind: 'patch'; values: Values } | { kind: 'delta'; amount: number } | { kind: 'move'; target: string; amount: number } | { kind: 'delete' };
export interface Entry { id: string; revision: number; recorded: number; time: number; tx: string; handle: string; draft: boolean; op: Operation }
export interface Ledger { cutoff: number; bindings: { handle: string; entity_id: string; start: number; end: number }[];
  entries: Entry[]; decisions: { tx: string; revision: number; recorded: number; decision: 'commit' | 'abort' }[] }
export function ledgerReference(p: Ledger) {
  const decisions = new Map<string, Ledger['decisions'][number]>(), entries = new Map<string, Entry>(), records = new Map<string, RecordValue>();
  for (const d of p.decisions) if (d.recorded <= p.cutoff && (!decisions.has(d.tx) || d.revision > decisions.get(d.tx)!.revision)) decisions.set(d.tx, d);
  for (const e of p.entries) if (!e.draft && e.recorded <= p.cutoff && (!entries.has(e.id) || e.revision > entries.get(e.id)!.revision)) entries.set(e.id, e);
  const resolve = (h: string, time: number) => { const a = p.bindings.filter(b => b.handle === h && b.start <= time && time < b.end); return a.length === 1 ? a[0].entity_id : null; };
  for (const e of [...entries.values()].filter(e => e.time <= p.cutoff && decisions.get(e.tx)?.decision === 'commit').sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))) {
    const id = resolve(e.handle, e.time); if (!id) continue;
    const op = e.op, current = records.get(id);
    if (op.kind === 'put') records.set(id, { entity_id: id, label: op.values.label!, quantity: op.values.quantity ?? 0, due_date: op.values.due_date ?? null, owner: op.values.owner ?? null });
    else if (op.kind === 'delete') records.delete(id);
    else if (current && op.kind === 'patch') records.set(id, { ...current, ...op.values });
    else if (current && op.kind === 'delta') current.quantity += op.amount;
    else if (current && op.kind === 'move') {
      const target = resolve(op.target, e.time), to = target ? records.get(target) : undefined;
      if (to && id !== target && current.quantity >= op.amount) { current.quantity -= op.amount; to.quantity += op.amount; }
    }
  }
  return { records: [...records.values()].sort((a, b) => a.entity_id.localeCompare(b.entity_id)) };
}
export function gradeLedger(p: Ledger, v: unknown) {
  if (!exactKeys(v, ['records']) || !Array.isArray(v.records) || v.records.length > 100 || v.records.some(r => !object(r) || typeof r.entity_id !== 'string') || new Set(v.records.map(r => r.entity_id)).size !== v.records.length) return { valid: false, score: null, pass: false };
  const records = v.records, gold = ledgerReference(p).records, wanted = new Map(gold.map(r => [r.entity_id, r]));
  let matched = 0, predicted = 0;
  for (const row of v.records) for (const k of Object.keys(row)) { predicted++; const g = wanted.get(row.entity_id); if (g && Object.hasOwn(g, k) && equal(row[k], g[k as keyof RecordValue])) matched++; }
  const required = gold.length * 5, score = required + predicted ? 200 * matched / (required + predicted) : 100;
  return { valid: true, pass: matched === required && matched === predicted, score,
    diagnostics: { matched, predicted, required, recordCountCorrect: v.records.length === gold.length,
      wrongOrMissing: gold.flatMap(g => Object.keys(g).filter(k => !equal(records.find((r: any) => r.entity_id === g.entity_id)?.[k], g[k as keyof RecordValue])).map(k => `${g.entity_id}.${k}`)) } };
}
export function buildLedger(seed: number, tier: Tier) {
  const n = [8, 16, 24][tier - 1], r = random(seed ^ (tier * 104729));
  const ids = Array.from({ length: n }, (_, i) => `E${integer(r, 1000, 9999)}${i}`), handles = ids.map((_, i) => `${['东区', '西区', '北区'][i % 3]}${String.fromCharCode(65 + Math.floor(i / 3))}号柜`);
  const p: Ledger = { cutoff: 300, bindings: [], entries: [], decisions: [] };
  ids.forEach((entity_id, i) => {
    p.bindings.push({ handle: handles[i], entity_id, start: 0, end: 90 }, { handle: handles[i], entity_id: ids[(i + 1) % n], start: 90, end: 1000 }, { handle: `档案${entity_id}`, entity_id, start: 0, end: 1000 });
  });
  const txs = Array.from({ length: n + 3 }, (_, i) => `批${integer(r, 1000, 9999)}${i}`), baseTx = '初建批';
  p.decisions.push({ tx: baseTx, revision: 1, recorded: 10, decision: 'commit' });
  txs.forEach((tx, i) => {
    p.decisions.push({ tx, revision: 1, recorded: 280, decision: i % 4 === 1 ? 'abort' : 'commit' });
    if (i % 3 === 0) p.decisions.push({ tx, revision: 2, recorded: 295, decision: i % 2 ? 'abort' : 'commit' });
    if (i % 4 === 0) p.decisions.push({ tx, revision: 3, recorded: 320, decision: 'abort' });
  });
  const add = (i: number, time: number, tx: string, op: Operation, direct = false) => {
    const e: Entry = { id: `流水${integer(r, 10000, 99999)}-${p.entries.length}`, revision: 1, recorded: time + 5, time, tx,
      handle: direct ? `档案${ids[i]}` : handles[i], draft: false, op }; p.entries.push(e); return e;
  };
  ids.forEach((_, i) => add(i, i + 1, baseTx, { kind: 'put', values: { label: ['青禾标准件', '青禾标准件', '青禾改型件'][i % 3], quantity: integer(r, 20, 100),
    due_date: i % 3 ? `2026-11-${10 + i % 18}` : null, owner: ['林岚', '陈川', '周宁', '顾雨'][i % 4] } }));
  ids.forEach((_, i) => {
    const delta = add(i, 30 + i, txs[i % txs.length], { kind: 'delta', amount: integer(r, -12, 35) });
    if (i % 3 === 0) p.entries.push({ ...structuredClone(delta), revision: 2, recorded: 275, op: { kind: 'delta', amount: integer(r, -10, 30) } });
    add(i, 110 + i, txs[(i + 1) % txs.length], { kind: 'move', target: handles[(i + 3) % n], amount: integer(r, 15, 75) });
    add(i, 160 + i, txs[(i + 2) % txs.length], { kind: 'patch', values: i % 2 ? { owner: i % 3 ? '夏青' : null } : { due_date: i % 4 ? '2026-12-07' : null } });
    add(i, 195 + i, txs[(i + 3) % txs.length], { kind: 'move', target: `档案${ids[(i + 5) % n]}`, amount: integer(r, 10, 65) }, true);
    if (i % 4 === 0) add(i, 230 + i, txs[(i + 2) % txs.length], { kind: 'delete' }, true);
    if (i % 6 === 0) add(i, 260 + i, txs[(i + 1) % txs.length], { kind: 'put', values: { label: '青禾返修件', quantity: integer(r, 5, 20) } }, true);
    if (i % 5 === 0) p.entries.push({ ...structuredClone(delta), revision: 9, recorded: 299, draft: true, op: { kind: 'delta', amount: 999 } });
    if (i % 4 === 0) p.entries.push({ ...structuredClone(delta), revision: 8, recorded: 310, op: { kind: 'delta', amount: -999 } });
  });
  p.entries.push(structuredClone(p.entries[1]), structuredClone(p.entries[n + 1]));
  const reference = ledgerReference(p), textValues = (v: Values) => Object.entries(v).map(([k, value]) => `${({ label: '品名', quantity: '数量（件）', due_date: '交付日', owner: '经办人' } as any)[k]}${value === null ? '明确清空' : `改为「${value}」`}`).join('，');
  const documents = p.entries.map((e, i) => {
    const op = e.op, body = op.kind === 'put' ? `为${e.handle}新建或整体替换一条记录：${textValues(op.values)}。未列的数量记0，交付日和经办人记空。`
      : op.kind === 'patch' ? `仅对${e.handle}现存记录更新：${textValues(op.values)}。其余字段保留。`
      : op.kind === 'delta' ? `${e.handle}的数量${op.amount >= 0 ? '增加' : '减少'}${Math.abs(op.amount)}件。`
      : op.kind === 'move' ? `从${e.handle}划转${op.amount}件至${op.target}。只有双方记录均存在、不是同一实体且转出方数量足够时整笔执行，否则整笔不发生。`
      : `删除${e.handle}的整条记录。`;
    return `${['交接邮件', '仓务单', '复核附页'][i % 3]}【${e.id}，第${e.revision}版，${e.draft ? '未批准草稿' : '正式'}】登记于${e.recorded}，业务生效时刻${e.time}，所属${e.tx}：${body}`;
  });
  const bindingText = p.bindings.map(b => `${b.handle}在[${b.start},${b.end})指向${b.entity_id}。`);
  const decisions = p.decisions.map(d => `裁定函：${d.tx}，修订${d.revision}，登记时刻${d.recorded}，${d.decision === 'commit' ? '确认整批提交' : '整批撤销'}。`);
  return makeCase(seed, tier, 'data_extraction', 'natural_archive_transaction_reconstruction', p, reference,
    `从下列虚构仓务档案重建截止时刻300的有效实体记录。相同品名或柜号不代表同一实体。柜号按业务生效时刻对应的半开区间解析，档案号则始终指向同一实体。\n先处理版本与批次：只看截止前登记的正式流水版本，同流水取版本号最高者，整份替代旧版；草稿和未来登记版本不替代旧版；完全相同的重传只算一次。每批以截止前登记的最高修订裁定为准，只回放最终提交批次，撤销批次全部忽略。随后按业务生效时刻排序（同刻按流水编号字典序），只执行业务时刻不晚于300的流水。注意：先撤销批次再按时间重放，不能在当前余额上简单反向加减。\n绑定不唯一或无绑定的流水不执行。删除后不存在的记录不能被更新、增减或划转重新创建；新建/整体替换可以创建。划转两端条件不满足时两端都不变；数量增减按整数运算，允许负数。没有某字段不等于该字段被清空；明确清空才记null。\n输出通用JSON {"records":[{"entity_id":字符串,"label":字符串,"quantity":整数,"due_date":字符串或null,"owner":字符串或null}]}，自行确定实体集合，顺序不限。${ANSWER_POLICY}\n绑定登记：\n${shuffle(bindingText, seed + tier).join('\n')}\n档案材料（排列不代表时间顺序）：\n${shuffle([...documents, ...decisions], seed + tier * 47).join('\n')}`);
}
