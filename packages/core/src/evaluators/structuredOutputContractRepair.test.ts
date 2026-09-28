import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Scenario } from '@zxbench/types';
import { summarizeCriteria } from '../audit.js';
import { structuredOutputEvaluator } from './structuredOutput.js';

const candidates = JSON.parse(readFileSync('data/pilots/structured-output-contract-repair.json', 'utf8')) as Scenario[];
const byId = (id: string) => candidates.find(s => s.id === id)!;
const strict = async (scenario: Scenario, output: unknown) => summarizeCriteria(
  (await structuredOutputEvaluator.evaluate(scenario, typeof output === 'string' ? output : JSON.stringify(output), {} as never, {} as never)).criterionResults,
).strictPass;

describe('released structured output contract repairs', () => {
  it('checks every department and project, while accepting both allowed address shapes', async () => {
    const department = { name: '研发', leader: '李四', employee_count: 2,
      projects: [{ name: '甲', status: 'active' }, { name: '乙', status: 'done' }] };
    const good = { company_name: '示例公司', founded_date: '2024-01-01', address: { city: '北京' },
      departments: [structuredClone(department), structuredClone(department), structuredClone(department)] };
    expect(await strict(byId('SO-CN-001'), good)).toBe(true);
    good.departments[2].projects.pop();
    expect(await strict(byId('SO-CN-001'), good)).toBe(false);
  });

  it('verifies the full CSV contents, including the multiline cell', async () => {
    const good = 'sku,name,desc,price,qty\nA-1,无线鼠标,"静音, 便携, 支持蓝牙",129.00,12\nA-2,机械键盘,"轴体为""青轴"", 手感清脆",499.00,5\nA-3,显示器,"尺寸 27 英寸\n分辨率 2560x1440",1899.00,3\nA-4,数据线,"Type-C, 1.5 米",39.90,20\nA-5,支架,"铝合金, 可升降",259.00,8';
    expect(await strict(byId('SO-CN-043'), good)).toBe(true);
    expect(await strict(byId('SO-CN-043'), good.replace('499.00', '500.00'))).toBe(false);
  });

  it('requires an authored schema to generalize beyond shown SKU examples', async () => {
    const scenario = { ...byId('SO-CN-053'), requirements: {
      format: 'json', output_policy: 'raw_only', constraints: [
        'schemaAccepts:schema={"sku":"A-999","qty":1000}',
        'schemaRejectsLiteral:schema={"sku":"A-1","qty":9}',
      ],
    } } as Scenario;
    const schema = { type: 'object', properties: { sku: { type: 'string', pattern: '^A-\\d+$' },
      qty: { type: 'integer', minimum: 10 } }, required: ['sku','qty'] };
    expect(await strict(scenario, { schema })).toBe(true);
    schema.properties.qty = { type: 'integer', minimum: 10, maximum: 44 } as typeof schema.properties.qty;
    expect(await strict(scenario, { schema })).toBe(false);
  });
});
