// Development-only structured-output calibration pack. No database or model calls.
import { mkdirSync, writeFileSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const builders = [
  ['project-and-filter', v => {
    const input = { users: [
      { id: 'u3', name: '李三', active: v !== 1, secret: 'x' },
      { id: 'u1', name: '王一', active: v === 2, secret: 'y' },
      { id: 'u2', name: '陈二', active: v === 0, secret: 'z' },
    ] };
    return { instruction: '只保留 active=true 的用户，按原顺序输出 id、name；不得带出 secret。输出对象的唯一键为 records。', input,
      expected: { records: input.users.filter(x => x.active).map(({ id, name }) => ({ id, name })) } };
  }],
  ['null-versus-omitted', v => {
    const input = { name: ['甲', '乙', '丙'][v], phone: [null, '', '13800000000'][v] };
    return { instruction: '输出对象始终包含 name；phone 为 null 时省略 contact 键，否则保留原字符串，包括空字符串。', input,
      expected: input.phone === null ? { name: input.name } : { name: input.name, contact: input.phone } };
  }],
  ['discriminated-union', v => {
    const input = { events: [
      { kind: 'paid', id: `p${v}`, amount: v + 1 },
      { kind: 'failed', id: `f${v}`, reason: v === 1 ? '' : 'timeout' },
      ...(v === 2 ? [{ kind: 'paid', id: 'p-extra', amount: 0 }] : []),
    ] };
    return { instruction: '输出唯一键 events；每条转为 {id,type,payload}。paid 的 type="payment"、payload={amount}；failed 的 type="error"、payload={reason}。保留顺序和空字符串。', input,
      expected: { events: input.events.map(x => ({ id: x.id, type: x.kind === 'paid' ? 'payment' : 'error',
        payload: x.kind === 'paid' ? { amount: x.amount } : { reason: x.reason } })) } };
  }],
  ['stable-sort', v => {
    const input = { jobs: [
      { id: 'b', priority: v + 1 }, { id: 'a', priority: v === 1 ? v + 2 : v + 1 },
      { id: 'c', priority: v + 2 },
    ] };
    return { instruction: '按 priority 降序稳定排序；相同 priority 保持输入顺序。输出唯一键 jobIds，值为排序后的 id 字符串数组。', input,
      expected: { jobIds: input.jobs.map((x, i) => ({ ...x, i })).sort((a, b) => b.priority - a.priority || a.i - b.i).map(x => x.id) } };
  }],
  ['fixed-category-counts', v => {
    const input = { states: [['open', 'closed', 'open'], [], ['blocked', 'blocked', 'closed']][v] };
    return { instruction: '输出唯一键 counts，内部恰好包含 open、closed、blocked 三个整数计数，未出现的类别记 0。', input,
      expected: { counts: Object.fromEntries(['open', 'closed', 'blocked'].map(k => [k, input.states.filter(x => x === k).length])) } };
  }],
  ['join-with-missing-reference', v => {
    const input = { owners: [{ id: 'u1', name: '甲' }, { id: 'u2', name: '乙' }],
      tasks: [{ id: `t${v}`, ownerId: v === 0 ? 'u1' : 'missing' }, { id: 't2', ownerId: 'u2' }] };
    return { instruction: '按 tasks 原顺序输出唯一键 tasks 数组；元素恰好为 taskId、ownerName。匹配不到 ownerId 时 ownerName 必须为 null。', input,
      expected: { tasks: input.tasks.map(t => ({ taskId: t.id, ownerName: input.owners.find(o => o.id === t.ownerId)?.name ?? null })) } };
  }],
  ['first-wins-dedup', v => {
    const input = { items: [
      { code: 'A', label: `first-${v}` }, { code: 'B', label: 'middle' },
      { code: 'A', label: 'later' }, ...(v === 2 ? [{ code: 'B', label: 'later-B' }] : []),
    ] };
    return { instruction: '按 code 精确匹配去重，保留第一次出现的完整元素，输出唯一键 items，顺序不变。', input,
      expected: { items: input.items.filter((x, i) => input.items.findIndex(y => y.code === x.code) === i) } };
  }],
  ['flatten-nested-records', v => {
    const input = { departments: [
      { id: 'd1', people: v === 1 ? [] : [{ id: 'u1', name: '甲' }] },
      { id: 'd2', people: [{ id: `u${v + 2}`, name: '乙' }] },
    ] };
    return { instruction: '按部门及人员原顺序展开，输出唯一键 people；每个元素恰好为 departmentId、id、name。空部门不产生记录。', input,
      expected: { people: input.departments.flatMap(d => d.people.map(p => ({ departmentId: d.id, id: p.id, name: p.name }))) } };
  }],
  ['branch-specific-fields', v => {
    const input = { jobs: [
      { id: 'a', status: 'queued' }, { id: 'b', status: 'failed', error: v === 1 ? '' : 'E42' },
      { id: 'c', status: v === 2 ? 'failed' : 'running', ...(v === 2 ? { error: 'E43' } : {}) },
    ] };
    return { instruction: '输出唯一键 jobs。每项保留 id，把 queued/running/failed 分别映射为 Q/R/F 写入 state；仅 failed 项保留 error，其他项禁止出现 error。', input,
      expected: { jobs: input.jobs.map(x => ({ id: x.id, state: { queued: 'Q', running: 'R', failed: 'F' }[x.status],
        ...(x.status === 'failed' ? { error: x.error } : {}) })) } };
  }],
  ['json-pointer-escaping', v => {
    const input = { keys: [['a/b', 'x~y'], ['', 'plain'], ['~/', 'a b']][v] };
    return { instruction: '输出唯一键 pointers；按输入顺序把每个键变成 RFC 6901 JSON Pointer 的单段指针：先将 ~ 替换为 ~0，再将 / 替换为 ~1，最后在前面加 /。空键对应 /。', input,
      expected: { pointers: input.keys.map(k => '/' + k.replace(/~/g, '~0').replace(/\//g, '~1')) } };
  }],
  ['override-with-null', v => {
    const input = { defaults: { timeout: 30, retries: 2, label: 'default' },
      overrides: [{ timeout: null }, { retries: 0 }, { label: '' }][v] };
    return { instruction: '输出唯一键 config；先复制 defaults，再按同名键应用 overrides。null、0、空字符串都属于明确覆盖，不能忽略。', input,
      expected: { config: { ...input.defaults, ...input.overrides } } };
  }],
  ['rank-with-ties', v => {
    const input = { scores: [
      { id: 'b', score: v === 1 ? 0 : 8 }, { id: 'a', score: 8 }, { id: 'c', score: v === 2 ? 9 : 4 },
    ] };
    const ordered = [...input.scores].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return { instruction: '按 score 降序、同分按 id 升序排序；输出唯一键 ranking。每项恰好含 id 和从 1 开始的连续 rank，同分也占不同名次。', input,
      expected: { ranking: ordered.map((x, i) => ({ id: x.id, rank: i + 1 })) } };
  }],
];

function schemaFor(value) {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    const itemSchemas = [...new Map(value.map(item => {
      const schema = schemaFor(item);
      return [JSON.stringify(schema), schema];
    })).values()];
    return { type: 'array', minItems: value.length, maxItems: value.length,
      items: itemSchemas.length === 0 ? {} : itemSchemas.length === 1 ? itemSchemas[0] : { anyOf: itemSchemas } };
  }
  if (typeof value === 'object') return { type: 'object', required: Object.keys(value),
    additionalProperties: false, properties: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, schemaFor(v)])) };
  return { type: typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value };
}

const scenarios = [];
const gold = [];
for (const [index, [family, build]] of builders.entries()) {
  for (let variant = 0; variant < 3; variant++) {
    const { instruction, input, expected } = build(variant);
    const id = `SO-PILOT-${String(index + 1).padStart(2, '0')}-${variant + 1}`;
    const scenario = {
      id, dimension: 'structured_output', category: family, difficulty: 'hard', language: 'json', locale: 'zh-CN',
      status: 'valid', tier: 'public_dev', grader: 'schema_compliance', graderVersion: 'schema_compliance_v6',
      scenarioVersion: '1.0.0', scenarioHash: '', scoring: { type: 'schema_compliance' },
      promptTemplate: `${instruction}\n\n输入数据：${JSON.stringify(input)}\n\n只输出 JSON，不要代码围栏或说明。`,
      requirements: { format: 'json', output_policy: 'raw_only', developmentShadow: true,
        schema: schemaFor(expected), constraints: [`jsonEq:.=${JSON.stringify(expected)}`],
        axis_weights: { syntax_parse: 0.05, schema_compliance: 0.2, field_constraints: 0.7, output_discipline: 0.05 } },
      tags: ['structured-output-pilot', 'fixture-anchored', `family:${family}`],
      reviewStatus: 'unreviewed', goldSource: 'programmatic-fixture-v1',
    };
    scenario.scenarioHash = hashScenarioShort(scenario);
    scenarios.push(scenario);
    gold.push({ id, family, variant: variant + 1, expected });
  }
}
const base = new URL('../data/pilots/', import.meta.url);
mkdirSync(base, { recursive: true });
writeFileSync(new URL('structured-output-v2.json', base), JSON.stringify(scenarios, null, 2) + '\n');
writeFileSync(new URL('structured-output-v2-gold.json', base), JSON.stringify(gold, null, 2) + '\n');
console.log(`Wrote ${scenarios.length} development scenarios across ${builders.length} families`);
