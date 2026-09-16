// structured_output 维度修复的回归测试（2026-09-16 评审）。
// 每个 describe 对应一项已修复缺陷，既有正向（不再误杀）也有反向（真错必须扣分）用例。
import { describe, expect, it } from 'vitest';
import type { Scenario, OutputMetadata } from '@zxbench/types';
import { structuredOutputEvaluator as evaluator } from './structuredOutput.js';
import { classifyEngineeringFailure, computeScorerVersionDrift } from '../scoring.js';

const meta = { truncated: false, incomplete: false } as OutputMetadata;
const response = {} as never;

async function score(requirements: Record<string, unknown>, output: string) {
  const scenario = { grader: 'schema_compliance', requirements } as unknown as Scenario;
  return evaluator.evaluate(scenario, output, meta, response) as Promise<{
    axisScores: Record<string, number>;
    axisEvidence: Record<string, string>;
    totalScore: number;
    evidence: string[];
  }>;
}

describe('B1 文本类格式的字段检查不再依赖 parsed 的运行时类型', () => {
  it('SQL 关键词从正文语料命中（旧实现 parsed 是语句数组，字段轴恒为 0）', async () => {
    const r = await score(
      { format: 'sql', output_policy: 'raw_only', requiredFields: ['SELECT', 'FROM', 'JOIN', 'PARTITION BY', 'ROW_NUMBER'] },
      'SELECT city, name FROM (SELECT u.city, ROW_NUMBER() OVER (PARTITION BY u.city ORDER BY o.amount DESC) rn FROM orders o JOIN users u ON u.id = o.user_id) t;',
    );
    expect(r.axisScores.field_constraints).toBe(100);
  });

  it('缺少关键词时仍然扣分', async () => {
    const r = await score({ format: 'sql', requiredFields: ['SELECT', 'ROW_NUMBER'] }, 'SELECT 1;');
    expect(r.axisScores.field_constraints).toBe(50);
  });
});

describe('B2 JSON 前后散文不再连带清零字段轴', () => {
  const body = '{"page":1,"pageSize":5,"total":5,"totalPages":1,"data":[]}';

  it('JSON 后附解释句：语法轴满分、字段轴满分、仅纪律轴扣分', async () => {
    const r = await score(
      { format: 'json', output_policy: 'raw_only', requiredFields: ['page', 'pageSize', 'total', 'totalPages', 'data'] },
      `${body}\n\n推理过程：已包含分页字段。`,
    );
    expect(r.axisScores.syntax_parse).toBe(100);
    expect(r.axisScores.field_constraints).toBe(100);
    expect(r.axisScores.output_discipline).toBe(0);
  });

  it('真正语法损坏的 JSON 仍判失败', async () => {
    const r = await score({ format: 'json', requiredFields: ['page'] }, '{"page":1,,"data":[]}');
    expect(r.axisScores.syntax_parse).toBeLessThan(100);
    expect(r.axisScores.field_constraints).toBe(0);
  });
});

describe('B3 markdown 正文不再被第一个围栏替换', () => {
  it('文档内含 http 围栏时仍能命中 # / | / 有序列表', async () => {
    const doc = '# 报告\n\n## 目录\n\n```http\nAuthorization: Bearer x\n```\n\n| 月份 | 金额 |\n| --- | --- |\n| 1月 | 100 |\n\n1. 结论一\n';
    const r = await score({ format: 'markdown', output_policy: 'fenced_allowed', requiredFields: ['#', '|', '1.'] }, doc);
    expect(r.axisScores.field_constraints).toBe(100);
  });
});

describe('B4 CSV 尾部散文不再被当作数据行', () => {
  const csv = '工号,姓名,部门\nEMP001,张伟,技术部\nEMP002,李娜,产品部';

  it('尾部「推理过程」被截断为警告而非列数错误', async () => {
    const r = await score(
      { format: 'csv', output_policy: 'raw_only', requiredFields: ['工号', '姓名', '部门'] },
      `${csv}\n\n推理过程：\n1. 严格遵循字段顺序。\n2. 未使用引号包裹。`,
    );
    expect(r.axisScores.syntax_parse).toBe(100);
    expect(r.axisScores.field_constraints).toBe(100);
    expect(r.evidence.some((e) => e.includes('Discarded'))).toBe(true);
  });

  it('真正的列数不匹配仍然报错', async () => {
    const r = await score({ format: 'csv', requiredFields: ['工号', '姓名'] }, '工号,姓名\nEMP001,张伟,多余列');
    expect(r.axisScores.syntax_parse).toBeLessThan(100);
  });
});

describe('B5/B6 XML 命名空间前缀与自闭合标签', () => {
  it('带前缀的闭合标签不再误报 unclosed', async () => {
    const xml = '<?xml version="1.0"?>\n<soap:Envelope xmlns:soap="http://x"><soap:Body><w:GetWeather xmlns:w="http://y"><w:City>北京</w:City></w:GetWeather></soap:Body></soap:Envelope>';
    const r = await score({ format: 'xml', output_policy: 'raw_only', requiredFields: ['Envelope', 'Body', 'GetWeather', 'xml'] }, xml);
    expect(r.axisScores.syntax_parse).toBe(100);
    expect(r.axisScores.field_constraints).toBe(100);
  });

  it('自闭合标签不再被当成未闭合', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>t</title><rect width="10" height="10"/><circle cx="1" cy="1" r="1"/></svg>';
    const r = await score({ format: 'xml', requiredFields: ['svg', 'viewBox', 'rect', 'circle'] }, svg);
    expect(r.axisScores.syntax_parse).toBe(100);
  });

  it('真正未闭合的标签仍然报错', async () => {
    const r = await score({ format: 'xml', requiredFields: ['root'] }, '<root><child></root>');
    expect(r.axisScores.syntax_parse).toBeLessThan(100);
  });
});

describe('B7 Mermaid erDiagram 基数记法不再误报未闭合括号', () => {
  it('||--o{ 关系线不计入括号平衡', async () => {
    const diagram = 'erDiagram\n  USER {\n    int id PK\n  }\n  COURSE {\n    int id PK\n  }\n  USER ||--o{ COURSE : "instructs"\n';
    const r = await score(
      { format: 'mermaid', output_policy: 'fenced_allowed', requiredFields: ['erDiagram', 'USER', 'COURSE'] },
      `\`\`\`mermaid\n${diagram}\`\`\``,
    );
    expect(r.axisScores.syntax_parse).toBe(100);
  });

  it('真正未闭合的括号仍然报错', async () => {
    const r = await score({ format: 'mermaid', requiredFields: ['flowchart'] }, 'flowchart TD\n  A[开始 --> B[结束]');
    expect(r.axisScores.syntax_parse).toBeLessThan(100);
  });
});

describe('字段表达力：备选路径 / 任意深度 / 字面 token', () => {
  it('`a||b` 备选路径任一命中即通过', async () => {
    const r = await score({ format: 'json', requiredFields: ['amounts.items_total||items_total'] }, '{"amounts":{"items_total":10}}');
    expect(r.axisScores.field_constraints).toBe(100);
    const r2 = await score({ format: 'json', requiredFields: ['amounts.items_total||items_total'] }, '{"items_total":10}');
    expect(r2.axisScores.field_constraints).toBe(100);
  });

  it('单个 `|` 仍可作为 markdown 表格的字面字段', async () => {
    const r = await score({ format: 'markdown', output_policy: 'raw_only', requiredFields: ['|'] }, '| a | b |\n| --- | --- |');
    expect(r.axisScores.field_constraints).toBe(100);
  });

  it('`**.key` 任意深度匹配（题面未规定容器名）', async () => {
    const r = await score({ format: 'json', requiredFields: ['**.grand_total'] }, '{"amount":{"grand_total":99}}');
    expect(r.axisScores.field_constraints).toBe(100);
    const r2 = await score({ format: 'json', requiredFields: ['**.grand_total'] }, '{"a":{"b":{"c":{"grand_total":1}}}}');
    expect(r2.axisScores.field_constraints).toBe(100);
    const r3 = await score({ format: 'json', requiredFields: ['**.grand_total'] }, '{"amount":{"total":99}}');
    expect(r3.axisScores.field_constraints).toBe(0);
  });

  it('TOML 段名写裸名即匹配 [section] 与 [[section]]', async () => {
    const toml = '[workspace]\nmembers = []\n[package]\nname = "x"\n[[bin]]\nname = "a"\n';
    const r = await score({ format: 'toml', requiredFields: ['workspace', 'package', 'bin'] }, toml);
    expect(r.axisScores.field_constraints).toBe(100);
  });

  it('YAML 结构性 token（--- / &anchor / *alias）按字面匹配', async () => {
    const yaml = 'metadata: &m\n  name: a\n---\nother: *m\n';
    const r = await score({ format: 'yaml', requiredFields: ['---', '&m', '*m'] }, yaml);
    expect(r.axisScores.field_constraints).toBe(100);
  });

  it('HTML 的 style 字段接受内联 style 属性', async () => {
    const html = '<!DOCTYPE html><html><head></head><body style="margin:0"><table style="x"><img src="a"></table></body></html>';
    const r = await score({ format: 'html', requiredFields: ['html', 'table', 'style', 'img', 'body'] }, html);
    expect(r.axisScores.syntax_parse).toBe(100);
    expect(r.axisScores.field_constraints).toBe(100);
  });

  it('跨字段数值恒等式 equals-sum', async () => {
    const rules = { format: 'json', crossFieldRules: ['equals-sum:amounts.grand_total=amounts.items_total+amounts.shipping_fee-amounts.discount+amounts.tax'] };
    const ok = await score(rules, '{"amounts":{"items_total":100,"shipping_fee":10,"discount":5,"tax":2,"grand_total":107}}');
    expect(ok.axisScores.cross_field_consistency).toBe(100);
    const bad = await score(rules, '{"amounts":{"items_total":100,"shipping_fee":10,"discount":5,"tax":2,"grand_total":999}}');
    expect(bad.axisScores.cross_field_consistency).toBe(0);
  });
});

describe('B8 输出纪律分级', () => {
  it('raw_only 下围栏记 0，无围栏记 100', async () => {
    expect((await score({ format: 'json', output_policy: 'raw_only', requiredFields: ['a'] }, '```json\n{"a":1}\n```')).axisScores.output_discipline).toBe(0);
    expect((await score({ format: 'json', output_policy: 'raw_only', requiredFields: ['a'] }, '{"a":1}')).axisScores.output_discipline).toBe(100);
  });

  it('fenced_allowed 下白名单围栏 + 尾部说明记 70，严格单围栏记 100', async () => {
    const req = { format: 'mermaid', output_policy: 'fenced_allowed', allowed_fence_languages: ['mermaid'], requiredFields: ['flowchart'] };
    expect((await score(req, '```mermaid\nflowchart TD\n  A-->B\n```\n\n原因：略。')).axisScores.output_discipline).toBe(70);
    expect((await score(req, '```mermaid\nflowchart TD\n  A-->B\n```')).axisScores.output_discipline).toBe(100);
  });

  it('fenced_allowed 下非白名单围栏降级', async () => {
    const req = { format: 'mermaid', output_policy: 'fenced_allowed', allowed_fence_languages: ['mermaid'], requiredFields: ['flowchart'] };
    expect((await score(req, '```python\nflowchart TD\n```')).axisScores.output_discipline).toBe(20);
  });
});

describe('P1-5 JSON Schema 关键字扩展', () => {
  const req = (schema: Record<string, unknown>) => ({ format: 'json', output_policy: 'raw_only', schema });

  it('enum / const 反向用例必须命中', async () => {
    const r = await score(req({ type: 'object', properties: { role: { enum: ['admin', 'user'] } } }), '{"role":"root"}');
    expect(r.evidence.some((e) => e.includes('is not one of'))).toBe(true);
    const c = await score(req({ type: 'object', properties: { overallStatus: { const: 'failed' } } }), '{"overallStatus":"failure"}');
    expect(c.evidence.some((e) => e.includes('Expected const'))).toBe(true);
  });

  it('format 校验（date-time / uuid / email）', async () => {
    const r = await score(
      req({ type: 'object', properties: { createdAt: { type: 'string', format: 'date-time' }, id: { type: 'string', format: 'uuid' } } }),
      '{"createdAt":"2025/06/01 09:15","id":"not-a-uuid"}',
    );
    expect(r.evidence.filter((e) => e.includes('does not match format')).length).toBe(2);
    const ok = await score(
      req({ type: 'object', properties: { createdAt: { type: 'string', format: 'date-time' } } }),
      '{"createdAt":"2025-06-01T09:15:00Z"}',
    );
    expect(ok.axisScores.schema_compliance).toBe(100);
  });

  it('pattern 校验', async () => {
    const r = await score(req({ type: 'object', properties: { ticketNumber: { type: 'string', pattern: '^TKT-\\d+$' } } }), '{"ticketNumber":"ABC-1"}');
    expect(r.evidence.some((e) => e.includes('does not match pattern'))).toBe(true);
  });

  it('minItems / items 递归校验', async () => {
    const schema = { type: 'object', properties: { jobs: { type: 'array', minItems: 3, items: { type: 'object', required: ['name'] } } } };
    const r = await score(req(schema), '{"jobs":[{"name":"a"},{"b":2}]}');
    expect(r.evidence.some((e) => e.includes('below minItems'))).toBe(true);
    expect(r.evidence.some((e) => e.includes('Missing required field: "name"'))).toBe(true);
  });

  it('oneOf / anyOf / $ref→$defs', async () => {
    const oneOfSchema = {
      type: 'object',
      properties: { assignee: { oneOf: [{ type: 'object', required: ['id'] }, { type: 'null' }] } },
    };
    expect((await score(req(oneOfSchema), '{"assignee":null}')).axisScores.schema_compliance).toBe(100);
    expect((await score(req(oneOfSchema), '{"assignee":{"noId":1}}')).axisScores.schema_compliance).toBeLessThan(100);

    const refSchema = {
      type: 'object',
      $defs: { User: { type: 'object', required: ['username'] } },
      properties: { owner: { $ref: '#/$defs/User' } },
    };
    expect((await score(req(refSchema), '{"owner":{"username":"a"}}')).axisScores.schema_compliance).toBe(100);
    expect((await score(req(refSchema), '{"owner":{}}')).axisScores.schema_compliance).toBeLessThan(100);
  });

  it('schema 轴按覆盖率折算，不再一命中就归零', async () => {
    const schema = { type: 'object', required: ['a', 'b', 'c', 'd'], properties: { a: { type: 'string' }, b: { type: 'string' } } };
    const r = await score(req(schema), '{"a":"x","b":"y"}');
    expect(r.axisScores.schema_compliance).toBeGreaterThan(0);
    expect(r.axisScores.schema_compliance).toBeLessThan(100);
    expect(r.evidence.some((e) => e.includes('constraints'))).toBe(true);
  });

  it('未实现的关键字被忽略（不臆断），已实现的严格关键字独立生效', async () => {
    // unevaluatedProperties 仍未实现 → 必须被忽略而不是判错
    const ignored = await score(
      { format: 'json', output_policy: 'raw_only', schema: { type: 'object', unevaluatedProperties: false } },
      '{"x":1}',
    );
    expect(ignored.axisScores.schema_compliance).toBe(100);
    // additionalProperties:false 即使没有 properties 也必须拒绝多余键
    // （JSON Schema 语义：未声明 properties 时任何键都属于 additional）
    const strict = await score(
      { format: 'json', output_policy: 'raw_only', schema: { type: 'object', additionalProperties: false } },
      '{"x":1}',
    );
    expect(strict.axisScores.schema_compliance).toBeLessThan(100);
  });
});

describe('严格结构断言规则语言（恢复区分度用）', () => {
  const run = async (constraints: string[], doc: unknown) =>
    (await score({ format: 'json', output_policy: 'raw_only', constraints }, JSON.stringify(doc))).axisScores.field_constraints;

  it('keys：对象键集必须精确相等（多余键也判失败）', async () => {
    expect(await run(['keys:meta=a,b'], { meta: { a: 1, b: 2 } })).toBe(100);
    expect(await run(['keys:meta=a,b'], { meta: { a: 1, b: 2, c: 3 } })).toBe(0);
    expect(await run(['keys:meta=a,b'], { meta: { a: 1 } })).toBe(0);
  });

  it('keyOrder：键顺序必须完全一致', async () => {
    expect(await run(['keyOrder:meta=b,a'], { meta: { b: 1, a: 2 } })).toBe(100);
    expect(await run(['keyOrder:meta=b,a'], { meta: { a: 2, b: 1 } })).toBe(0);
  });

  it('reAll / maxDecimals / unique', async () => {
    const rows = [{ id: 'A-1', amount: 21.5 }, { id: 'A-2', amount: 30.25 }];
    expect(await run(['reAll:orders[].id:^A-\\d+$'], { orders: rows })).toBe(100);
    expect(await run(['reAll:orders[].id:^A-\\d+$'], { orders: [{ id: 'X1' }] })).toBe(0);
    expect(await run(['maxDecimals:orders[].amount=2'], { orders: rows })).toBe(100);
    expect(await run(['maxDecimals:orders[].amount=2'], { orders: [{ amount: 21.004999999999995 }] })).toBe(0);
    expect(await run(['unique:orders[].id'], { orders: rows })).toBe(100);
    expect(await run(['unique:orders[].id'], { orders: [{ id: 'A-1' }, { id: 'A-1' }] })).toBe(0);
  });

  it('sorted：多键排序（含 tie-break）', async () => {
    const good = [{ d: '2026-01-02', id: 'a' }, { d: '2026-01-02', id: 'b' }, { d: '2026-01-01', id: 'c' }];
    const bad = [{ d: '2026-01-02', id: 'b' }, { d: '2026-01-02', id: 'a' }, { d: '2026-01-01', id: 'c' }];
    expect(await run(['sorted:rows[]=d:desc,id:asc'], { rows: good })).toBe(100);
    expect(await run(['sorted:rows[]=d:desc,id:asc'], { rows: bad })).toBe(0);
  });

  it('ref：引用完整性', async () => {
    const users = [{ id: 'u1' }, { id: 'u2' }];
    expect(await run(['ref:orders[].userId in users[].id'], { users, orders: [{ userId: 'u1' }] })).toBe(100);
    expect(await run(['ref:orders[].userId in users[].id'], { users, orders: [{ userId: 'u9' }] })).toBe(0);
  });

  it('sumEq / productEq / runningTotal', async () => {
    const orders = [{ qty: 2, unitPrice: 10.5, amount: 21 }, { qty: 3, unitPrice: 4, amount: 12 }];
    expect(await run(['sumEq:orders[].amount=grandTotal'], { orders, grandTotal: 33 })).toBe(100);
    expect(await run(['sumEq:orders[].amount=grandTotal'], { orders, grandTotal: 99 })).toBe(0);
    expect(await run(['productEq:orders[].amount=qty*unitPrice:2'], { orders })).toBe(100);
    expect(await run(['productEq:orders[].amount=qty*unitPrice:2'], { orders: [{ qty: 2, unitPrice: 10.5, amount: 21.004999999999995 }] })).toBe(0);
    expect(await run(['runningTotal:ledger[].balance=delta:100'], { ledger: [{ delta: 10, balance: 110 }, { delta: -30, balance: 80 }] })).toBe(100);
    expect(await run(['runningTotal:ledger[].balance=delta:100'], { ledger: [{ delta: 10, balance: 110 }, { delta: -30, balance: 90 }] })).toBe(0);
  });

  it('schemaValidates：文档内的 schema 必须接受同文档的实例', async () => {
    const good = {
      schema: { type: 'object', required: ['n'], properties: { n: { type: 'number' } } },
      sample: { n: 1 },
    };
    const bad = {
      schema: { type: 'object', required: ['n'], properties: { n: { type: 'number' } } },
      sample: { n: 'not-a-number' },
    };
    expect(await run(['schemaValidates:schema:sample'], good)).toBe(100);
    expect(await run(['schemaValidates:schema:sample'], bad)).toBe(0);
  });

  it('count：正文正则命中次数（markdown 计数型断言）', async () => {
    const doc = '# 标题\n\n## A\n\n## B\n\n## C\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n';
    const r = await score(
      { format: 'markdown', output_policy: 'raw_only', constraints: ['count:^##\\s:>=3', 'count:^\\|:>=3'] },
      doc,
    );
    expect(r.axisScores.field_constraints).toBe(100);
    const r2 = await score(
      { format: 'markdown', output_policy: 'raw_only', constraints: ['count:^##\\s:>=3'] },
      '# 标题\n\n## A\n',
    );
    expect(r2.axisScores.field_constraints).toBe(0);
  });

  it('additionalProperties:false 会暴露多余键', async () => {
    const schema = {
      type: 'object',
      required: ['a'],
      properties: { a: { type: 'number' } },
      additionalProperties: false,
    };
    const clean = await score({ format: 'json', output_policy: 'raw_only', schema }, '{"a":1}');
    expect(clean.axisScores.schema_compliance).toBe(100);
    const dirty = await score({ format: 'json', output_policy: 'raw_only', schema }, '{"a":1,"extra":2}');
    expect(dirty.axisScores.schema_compliance).toBeLessThan(100);
    expect(dirty.evidence.some((e) => e.includes('additionalProperties:false'))).toBe(true);
  });

  it('无法解析的规则不会误伤（返回失败但不抛错）', async () => {
    expect(await run(['maxDecimals:orders[].amount=2'], { nothing: true })).toBe(0);
    expect(await run(['reAll:orders[].id:([invalid'], { orders: [{ id: 'a' }] })).toBe(0);
    expect(await run(['csvCell:9:9:x'], { rows: [] })).toBe(0);
  });

  it('length / keysAll / ratioEq / chainEq', async () => {
    const rows = [{ a: 1, b: 2 }, { a: 3, b: 4 }];
    expect(await run(['length:rows=2'], { rows })).toBe(100);
    expect(await run(['length:rows=3'], { rows })).toBe(0);
    expect(await run(['keysAll:rows=a,b'], { rows })).toBe(100);
    expect(await run(['keysAll:rows=a,b'], { rows: [{ a: 1, b: 2 }, { a: 3, b: 4, c: 5 }] })).toBe(0);

    const order = [{ amount: 100, tax: 6 }, { amount: 50, tax: 3 }];
    expect(await run(['ratioEq:rows[].tax=amount*0.06:2'], { rows: order })).toBe(100);
    expect(await run(['ratioEq:rows[].tax=amount*0.06:2'], { rows: [{ amount: 100, tax: 7 }] })).toBe(0);
    expect(await run(['ratioEq:rows[].tax=amount*0.06:2'], { rows: [{ amount: 100, tax: 6.000000000000001 }] })).toBe(0);

    const ledger = [
      { opening: 100, delta: 10, closing: 110 },
      { opening: 110, delta: -30, closing: 80 },
    ];
    expect(await run(['chainEq:ledger[].opening=closing:100'], { ledger })).toBe(100);
    expect(await run(['chainEq:ledger[].opening=closing:100'], {
      ledger: [{ opening: 100, delta: 10, closing: 110 }, { opening: 999, delta: -30, closing: 80 }],
    })).toBe(0);
  });

  it('schemaRejects：反向自洽（实例必须被 schema 拒绝）', async () => {
    const doc = {
      schema: { type: 'object', required: ['n'], properties: { n: { type: 'number' } } },
      broken: { n: 'str' },
    };
    expect(await run(['schemaRejects:schema:broken'], doc)).toBe(100);
    expect(await run(['schemaRejects:schema:broken'], {
      schema: { type: 'object', required: ['n'], properties: { n: { type: 'number' } } },
      broken: { n: 1 },
    })).toBe(0);
  });

  it('csvCell：解析后的 RFC4180 单元格内容', async () => {
    const csv = 'sku,name,desc\nA-1,"鼠标, 无线","含""引号""说明"\nA-2,键盘,"第一行\n第二行"\n';
    const r = await score(
      {
        format: 'csv',
        output_policy: 'raw_only',
        requiredFields: ['sku', 'name', 'desc'],
        constraints: ['csvCell:0:1:鼠标, 无线', 'csvCell:0:2:含"引号"说明', 'csvCell:1:2:第一行\\n第二行'],
      },
      csv,
    );
    expect(r.axisScores.syntax_parse).toBe(100);
    expect(r.axisScores.field_constraints).toBe(100);
  });

  it('order：文本类格式的相对顺序', async () => {
    const xml = '<quote><buyer>张三</buyer><items><item>a</item></items></quote>';
    const r = await score(
      { format: 'xml', output_policy: 'raw_only', requiredFields: ['quote', 'buyer', 'items'], constraints: ['order:<buyer>|</buyer>', 'order:<items>|</items>'] },
      xml,
    );
    expect(r.axisScores.field_constraints).toBe(100);
    const r2 = await score(
      { format: 'xml', output_policy: 'raw_only', constraints: ['order:</items>|<items>'] },
      xml,
    );
    expect(r2.axisScores.field_constraints).toBe(0);
  });
});

describe('新颖约束规则集（IFBench 配方：OOD + 可程序化验证）', () => {
  const run = async (constraints: string[], doc: unknown) =>
    (await score({ format: 'json', output_policy: 'raw_only', constraints }, JSON.stringify(doc))).axisScores.field_constraints;

  it('count 类：whereEq 带谓词计数', async () => {
    const rows = [{ s: 'failed' }, { s: 'passed' }, { s: 'failed' }];
    expect(await run(['whereEq:rows[].s=failed:==2'], { rows })).toBe(100);
    expect(await run(['whereEq:rows[].s=failed:>=3'], { rows })).toBe(0);
    expect(await run(['whereEq:rows[].s=passed:<2'], { rows })).toBe(100);
  });

  it('ratio 类：whereRatio 命中比例', async () => {
    const rows = [{ s: 'a' }, { s: 'a' }, { s: 'a' }, { s: 'b' }];
    expect(await run(['whereRatio:rows[].s=a:3/4'], { rows })).toBe(100);
    expect(await run(['whereRatio:rows[].s=a:1/2'], { rows })).toBe(0);
  });

  it('custom 类：uniqueTuple / setEquals / beforeInArray', async () => {
    const slots = [{ room: 'A', t: 1 }, { room: 'A', t: 2 }, { room: 'B', t: 1 }];
    expect(await run(['uniqueTuple:slots[]=room,t'], { slots })).toBe(100);
    expect(await run(['uniqueTuple:slots[]=room,t'], { slots: [{ room: 'A', t: 1 }, { room: 'A', t: 1 }] })).toBe(0);
    expect(await run(['setEquals:slots[].room=A,A,B'], { slots })).toBe(100);
    expect(await run(['setEquals:slots[].room=A,A,C'], { slots })).toBe(0);
    const order = [{ n: '开场' }, { n: '中段' }, { n: '闭幕' }];
    expect(await run(['beforeInArray:rows[].n=开场|闭幕'], { rows: order })).toBe(100);
    expect(await run(['beforeInArray:rows[].n=闭幕|开场'], { rows: order })).toBe(0);
  });

  it('format 类：keyOrderDesc / keyLengthMax / multipleOf', async () => {
    expect(await run(['keyOrderDesc:meta'], { meta: { z: 1, m: 2, a: 3 } })).toBe(100);
    expect(await run(['keyOrderDesc:meta'], { meta: { a: 1, m: 2, z: 3 } })).toBe(0);
    expect(await run(['keyLengthMax:meta=4'], { meta: { abcd: 1, ef: 2 } })).toBe(100);
    expect(await run(['keyLengthMax:meta=4'], { meta: { abcde: 1 } })).toBe(0);
    expect(await run(['multipleOf:rows[].n=25'], { rows: [{ n: 50 }, { n: 75 }] })).toBe(100);
    expect(await run(['multipleOf:rows[].n=25'], { rows: [{ n: 60 }] })).toBe(0);
  });

  it('custom 类：noNulls / depthEquals', async () => {
    expect(await run(['noNulls:.'], { a: 1, b: { c: 2 } })).toBe(100);
    expect(await run(['noNulls:.'], { a: 1, b: null })).toBe(0);
    // 深度：{a:{b:{c:1}}} → 3 层容器
    expect(await run(['depthEquals:.=3'], { a: { b: { c: 1 } } })).toBe(100);
    expect(await run(['depthEquals:.=2'], { a: { b: { c: 1 } } })).toBe(0);
  });

  it('words 类：notMatchAll 负面约束', async () => {
    const rows = [{ text: '天气不错' }, { text: '交通顺畅' }];
    expect(await run(['notMatchAll:rows[].text:[eE]'], { rows })).toBe(100);
    expect(await run(['notMatchAll:rows[].text:顺畅'], { rows })).toBe(0);
  });

  it('copy 类：deepEq 与字面量逐字节相等（含转义与特殊字符）', async () => {
    const doc = { key: 'line1\nline2', p: 'a/b~c', q: '"quoted"' };
    expect(await run(['deepEq:key="line1\\nline2"'], doc)).toBe(100);
    expect(await run(['deepEq:key="line1line2"'], doc)).toBe(0);
    expect(await run(['deepEq:p="a/b~c"'], doc)).toBe(100);
    expect(await run(['deepEq:q="\\"quoted\\""'], doc)).toBe(100);
  });
});

describe('JSON Schema 校验器扩展（对齐 JSONSchemaBench 的高阶特性）', () => {
  const withSchema = async (schema: Record<string, unknown>, doc: unknown) => {
    const r = await score({ format: 'json', output_policy: 'raw_only', schema }, JSON.stringify(doc));
    return r.axisScores.schema_compliance ?? 0;
  };

  it('not / if-then-else', async () => {
    expect(await withSchema({ type: 'object', not: { required: ['forbidden'] } }, { ok: 1 })).toBe(100);
    expect(await withSchema({ type: 'object', not: { required: ['forbidden'] } }, { forbidden: 1 })).toBeLessThan(100);
    const conditional = {
      type: 'object',
      if: { properties: { kind: { const: 'a' } }, required: ['kind'] },
      then: { required: ['onlyForA'] },
      else: { required: ['onlyForB'] },
    };
    expect(await withSchema(conditional, { kind: 'a', onlyForA: 1 })).toBe(100);
    expect(await withSchema(conditional, { kind: 'a', onlyForB: 1 })).toBeLessThan(100);
    expect(await withSchema(conditional, { kind: 'b', onlyForB: 1 })).toBe(100);
  });

  it('patternProperties / propertyNames / additionalProperties 子模式', async () => {
    const schema = {
      type: 'object',
      propertyNames: { pattern: '^[a-z_]+$' },
      patternProperties: { '^x_': { type: 'number' } },
      additionalProperties: { type: 'string' },
    };
    expect(await withSchema(schema, { x_a: 1, other: 's' })).toBe(100);
    expect(await withSchema(schema, { x_a: 'not-number' })).toBeLessThan(100);
    expect(await withSchema(schema, { Bad: 's' })).toBeLessThan(100);
    expect(await withSchema(schema, { other: 5 })).toBeLessThan(100);
  });

  it('dependentRequired / dependencies（schema 形式）', async () => {
    const dependentRequired = { type: 'object', dependentRequired: { credit: ['billing'] } };
    expect(await withSchema(dependentRequired, { credit: 'x', billing: 'y' })).toBe(100);
    expect(await withSchema(dependentRequired, { credit: 'x' })).toBeLessThan(100);

    const dependencies = { type: 'object', dependencies: { a: { required: ['b'] } } };
    expect(await withSchema(dependencies, { a: 1, b: 2 })).toBe(100);
    expect(await withSchema(dependencies, { a: 1 })).toBeLessThan(100);
  });

  it('contains / minContains / uniqueItems', async () => {
    const contains = { type: 'array', contains: { type: 'integer', minimum: 10 }, minContains: 2 };
    expect(await withSchema(contains, [1, 10, 20])).toBe(100);
    expect(await withSchema(contains, [1, 10, 2])).toBeLessThan(100);
    expect(await withSchema({ type: 'array', uniqueItems: true }, [1, 2, 3])).toBe(100);
    expect(await withSchema({ type: 'array', uniqueItems: true }, [1, 1])).toBeLessThan(100);
  });

  it('multipleOf / exclusiveMinimum / exclusiveMaximum / minProperties / maxProperties', async () => {
    expect(await withSchema({ type: 'number', multipleOf: 25 }, 75)).toBe(100);
    expect(await withSchema({ type: 'number', multipleOf: 25 }, 60)).toBeLessThan(100);
    expect(await withSchema({ type: 'number', exclusiveMinimum: 0 }, 0)).toBeLessThan(100);
    expect(await withSchema({ type: 'number', exclusiveMaximum: 10 }, 10)).toBeLessThan(100);
    expect(await withSchema({ type: 'object', minProperties: 2 }, { a: 1 })).toBeLessThan(100);
    expect(await withSchema({ type: 'object', maxProperties: 1 }, { a: 1, b: 2 })).toBeLessThan(100);
  });

  it('递归 $ref（树形结构，深度 5 仍可判定且不误判）', async () => {
    const treeSchema = {
      type: 'object',
      required: ['name'],
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        children: { type: 'array', items: { $ref: '#' } },
      },
    };
    const valid = { name: 'root', children: [{ name: 'a', children: [{ name: 'b', children: [{ name: 'c' }] }] }] };
    expect(await withSchema(treeSchema, valid)).toBe(100);
    // 第 4 层多了一个未声明键 → 递归分支必须抓到
    const invalid = { name: 'root', children: [{ name: 'a', children: [{ name: 'b', extra: 1 }] }] };
    expect(await withSchema(treeSchema, invalid)).toBeLessThan(100);
  });
});

describe('P0-8 基础设施失败必须与能力信号隔离', () => {
  it('生成阶段失败证据归类为 environment_error', () => {
    expect(classifyEngineeringFailure({
      evidence: ['Evaluation failed: Model request failed: fetch failed (ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:8081)'],
    })).toBe('environment_error');
  });

  it('正常证据不被误判为工程失败', () => {
    expect(classifyEngineeringFailure({ evidence: ['Format "json" parsed successfully'] })).toBeNull();
  });

  it('版本漂移审计跳过工程失败样本与 n/a 哨兵', () => {
    const pack = [{ id: 'A', grader: 'schema_compliance', graderVersion: 'schema_compliance_v5' }];
    const drift = computeScorerVersionDrift([
      { scenarioId: 'A', graderVersion: 'schema_compliance@schema_compliance_v5' },
      { scenarioId: 'A', graderVersion: 'n/a', evidence: ['Evaluation failed: fetch failed'] },
    ], pack);
    expect(drift.total).toBe(0);
    expect(drift.samples).toBe(1);
  });

  it('真实版本漂移仍被记录', () => {
    const pack = [{ id: 'A', grader: 'schema_compliance', graderVersion: 'schema_compliance_v5' }];
    const drift = computeScorerVersionDrift(
      [{ scenarioId: 'A', graderVersion: 'schema_compliance@schema_compliance_v2' }],
      pack,
    );
    expect(drift.total).toBe(1);
    expect(drift.byPair).toEqual({ 'schema_compliance@schema_compliance_v5 -> schema_compliance@schema_compliance_v2': 1 });
  });
});
