import { exactKeys, object, equal } from '../challengeTypes.js';
import { ANSWER_POLICY, integer, makeCase, random, shuffle, type ContentGrade } from './types.js';
export interface EntityRecord { entity_id: string; label: string; quantity: number | null; due_date: string | null }
interface Binding { handle: string; entity_id: string; start: number; end: number }
interface Event { event_id: string; tx: string; time: number; handle: string; op: 'put' | 'patch' | 'delete'; values: Partial<Omit<EntityRecord, 'entity_id'>> }
interface Decision { tx: string; revision: number; time: number; decision: 'commit' | 'abort' }
export interface JournalProblem { cutoff: number; bindings: Binding[]; events: Event[]; decisions: Decision[] }
export function journalReference(p: JournalProblem) {
  const decisions = new Map<string, Decision>();
  for (const d of p.decisions) if (d.time <= p.cutoff && (!decisions.has(d.tx) || decisions.get(d.tx)!.revision < d.revision)) decisions.set(d.tx, d);
  const events = [...new Map(p.events.map(e => [e.event_id, e])).values()]
    .filter(e => e.time <= p.cutoff && decisions.get(e.tx)?.decision === 'commit')
    .sort((a, b) => a.time - b.time || a.event_id.localeCompare(b.event_id));
  const records = new Map<string, EntityRecord>();
  for (const e of events) {
    const bindings = p.bindings.filter(b => b.handle === e.handle && b.start <= e.time && e.time < b.end);
    if (bindings.length !== 1) continue;
    const id = bindings[0].entity_id;
    if (e.op === 'delete') records.delete(id);
    else if (e.op === 'put') records.set(id, { entity_id: id, label: e.values.label!, quantity: e.values.quantity ?? null, due_date: e.values.due_date ?? null });
    else if (records.has(id)) records.set(id, { ...records.get(id)!, ...e.values });
  }
  return { records: [...records.values()].sort((a, b) => a.entity_id.localeCompare(b.entity_id)) };
}
/** Content micro-F1: no credit for well-formed but incorrect values. Record order
 * is irrelevant; extra records/fields count as false positives, missing as false negatives. */
export function verifyJournal(p: JournalProblem, v: unknown): ContentGrade {
  if (!exactKeys(v, ['records']) || !Array.isArray(v.records) || v.records.length > 100 ||
      v.records.some(row => !object(row) || typeof row.entity_id !== 'string') ||
      new Set(v.records.map(row => row.entity_id)).size !== v.records.length) return { valid: false, checks: [] };
  const expected = journalReference(p).records, wanted = new Map(expected.map(row => [row.entity_id, row]));
  let matched = 0, predicted = 0;
  const checks: { id: string; pass: boolean }[] = [];
  for (const row of v.records) {
    const gold = wanted.get(row.entity_id as string);
    // Entity presence is one atom, then each content field; unknown extra keys count too.
    for (const key of Object.keys(row)) {
      predicted++;
      const ok = !!gold && Object.hasOwn(gold, key) && equal(row[key], gold[key as keyof EntityRecord]);
      if (ok) matched++; checks.push({ id: `${row.entity_id}.${key}`, pass: ok });
    }
  }
  const required = expected.length * 4;
  for (const row of expected) {
    const actual = v.records.find(r => r.entity_id === row.entity_id);
    for (const key of Object.keys(row)) if (!actual || !Object.hasOwn(actual, key)) checks.push({ id: `${row.entity_id}.${key}:missing`, pass: false });
  }
  // Explicit empty output can be correct; empty checks must not cause accidental failure.
  if (!checks.length) checks.push({ id: 'empty_record_set', pass: !required && !predicted });
  return { valid: true, checks, score: required + predicted ? 200 * matched / (required + predicted) : 100 };
}
export function buildJournal(seed: number, instance: number) {
  const r = random(seed ^ Math.imul(instance + 1, 1237)), token = () => integer(r, 1000, 9999);
  const ids = Array.from({ length: 3 }, (_, i) => `E${token()}${i}`), handles = ['外部甲', '外部乙', '外部丙'];
  const txs = Array.from({ length: 5 }, (_, i) => `T${token()}${i}`), eventIds = Array.from({ length: 11 }, (_, i) => `L${token()}${i}`);
  const bindings: Binding[] = [
    { handle: handles[0], entity_id: ids[0], start: 0, end: 40 }, { handle: handles[0], entity_id: ids[1], start: 40, end: 200 },
    { handle: handles[1], entity_id: ids[1], start: 0, end: 200 }, { handle: handles[2], entity_id: ids[2], start: 0, end: 200 },
    { handle: '内部甲', entity_id: ids[0], start: 0, end: 200 },
  ];
  const labels = ['北辰标准版', '北辰标准版', '北辰增强版'];
  const events: Event[] = ids.map((_, i) => ({ event_id: eventIds[i], tx: txs[0], time: 10 + i, handle: handles[i], op: 'put',
    values: { label: labels[i], quantity: integer(r, 2, 20), due_date: i === 2 ? null : `2026-10-${20 + i}` } }));
  events.push(
    { event_id: eventIds[3], tx: txs[1], time: 30, handle: handles[0], op: 'patch', values: { quantity: integer(r, 21, 40) } },
    { event_id: eventIds[4], tx: txs[1], time: 50, handle: handles[0], op: 'patch', values: { quantity: 0, due_date: null } },
    { event_id: eventIds[5], tx: txs[2], time: 60, handle: handles[2], op: 'delete', values: {} },
    { event_id: eventIds[6], tx: txs[3], time: 70, handle: '内部甲', op: 'patch', values: { due_date: `2026-11-${integer(r, 10, 28)}` } },
    { event_id: eventIds[7], tx: txs[4], time: 80, handle: handles[2], op: 'patch', values: { quantity: integer(r, 41, 60) } },
    { event_id: eventIds[8], tx: txs[0], time: 120, handle: handles[1], op: 'delete', values: {} },
    { event_id: eventIds[9], tx: txs[3], time: 25, handle: '未绑定', op: 'put', values: { label: '草稿', quantity: 99, due_date: null } },
  );
  events.push(structuredClone(events[4]));
  const decisions: Decision[] = txs.map((tx, i) => ({ tx, revision: 1, time: 85 + i, decision: 'commit' }));
  decisions.push({ tx: txs[1], revision: 2, time: 110, decision: 'abort' });
  return ['committed', 'revoked', 'reordered'].map(variant => {
    const ds = structuredClone(decisions); ds.push({ tx: txs[2], revision: 2, time: 95, decision: variant === 'revoked' ? 'abort' : 'commit' });
    const problem: JournalProblem = { cutoff: 100, bindings: shuffle(bindings, seed + instance),
      events: shuffle(events, seed + instance + (variant === 'reordered' ? 991 : 23)), decisions: shuffle(ds, seed + instance + 47) };
    const prompt = `重建截止cutoff的有效实体记录。输入中的标签不是主键，同名不代表同一实体。\n规则：对每个事务，取截止前revision最高的裁定；仅commit事务的事件生效。abort撤销该事务全部事件，其他事务不受牵连。忽略截止后的裁定和事件。同event_id为完全相同事件的重传，只处理一次。有效事件按time升序，同刻按event_id字典序。\nhandle按事件发生时的[start,end)绑定解析，恰好一条绑定才处理。put创建/整体替换记录，未给quantity/due_date置null；patch只修改已有记录中给出的字段，null是显式空值而非删除字段；delete删除记录。对不存在实体的patch无效。\n输出通用结构 {"records":[{"entity_id":字符串,"label":字符串,"quantity":数字或null,"due_date":字符串或null}]}。自行确定记录数；记录顺序不限。${ANSWER_POLICY}\n输入：${JSON.stringify(problem)}`;
    return makeCase(seed, instance, 'data_extraction', 'transactional_reconstruction', variant, problem, journalReference(problem), prompt);
  });
}
