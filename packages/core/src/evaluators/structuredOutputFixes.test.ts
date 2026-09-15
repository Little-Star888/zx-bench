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

  it('未实现的关键字被忽略而不是判错', async () => {
    const r = await score(req({ type: 'object', additionalProperties: false, unevaluatedProperties: false }), '{"x":1}');
    expect(r.axisScores.schema_compliance).toBe(100);
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
