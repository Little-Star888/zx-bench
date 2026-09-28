// Prospective repairs for released questions. Do not mutate the active release or database.
import { readFileSync, writeFileSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const bank = JSON.parse(readFileSync(new URL('../data/scenarios/benchmark.json', import.meta.url), 'utf8'));
const get = id => {
  const scenario = bank.find(item => item.id === id);
  if (!scenario) throw new Error(`Missing released scenario ${id}`);
  return structuredClone(scenario);
};

const ordersQuestion = get('SO-CN-042');
const sourceLines = ordersQuestion.promptTemplate.match(/^A-\d{4},\d{4}-\d{2}-\d{2},u\d+,\d+,\d+(?:\.\d+)?$/gm);
if (sourceLines?.length !== 10 || !ordersQuestion.promptTemplate.includes('u1=张三，u2=李四，u3=王五')) {
  throw new Error('SO-CN-042 source fixture changed; review the repair before rebuilding');
}
const users = [{ id: 'u1', name: '张三' }, { id: 'u2', name: '李四' }, { id: 'u3', name: '王五' }];
const money = cents => Math.round(cents) / 100;
const orders = sourceLines.map(line => {
  const [id, date, userId, qtyText, priceText] = line.split(',');
  const qty = Number(qtyText);
  const unitPrice = Number(priceText);
  const amountCents = Math.round(qty * unitPrice * 100);
  const taxCents = Math.round(amountCents * 0.06);
  return { id, date, userId, qty, unitPrice, amount: money(amountCents), tax: money(taxCents), total: money(amountCents + taxCents) };
}).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
ordersQuestion.scenarioVersion = '4.0.0';
ordersQuestion.graderVersion = 'schema_compliance_v6';
ordersQuestion.requirements.schema = {
  type: 'object', required: ['generatedAt', 'users', 'orders', 'summary'], additionalProperties: false,
  properties: { generatedAt: { type: 'string', format: 'date-time' }, users: { type: 'array' },
    orders: { type: 'array' }, summary: { type: 'object', required: ['count', 'itemsTotal', 'taxTotal', 'grandTotal'],
      properties: { count: { type: 'integer' }, itemsTotal: { type: 'number' },
        taxTotal: { type: 'number' }, grandTotal: { type: 'number' } }, additionalProperties: false } },
};
ordersQuestion.requirements.constraints.push(
  `jsonEq:users=${JSON.stringify(users)}`,
  `jsonEq:orders=${JSON.stringify(orders)}`,
  'valueEq:summary.count=10',
);
ordersQuestion.requirements.constraints = [...new Set(ordersQuestion.requirements.constraints)];
ordersQuestion.scenarioHash = hashScenarioShort(ordersQuestion);

const schemaQuestion = get('SO-CN-047');
schemaQuestion.scenarioVersion = '4.0.0';
schemaQuestion.graderVersion = 'schema_compliance_v6';
// The prompt does not require a $schema key or forbid other standard metadata.
schemaQuestion.requirements.constraints = schemaQuestion.requirements.constraints
  .filter(rule => rule !== 'keys:schema=$schema,type,properties,required,additionalProperties');
schemaQuestion.requirements.constraints.push('valueEq:schema.additionalProperties=false');
schemaQuestion.requirements.constraints = [...new Set(schemaQuestion.requirements.constraints)];
schemaQuestion.scenarioHash = hashScenarioShort(schemaQuestion);

const repaired = [ordersQuestion, schemaQuestion];
writeFileSync(new URL('../data/pilots/structured-output-v2-repairs.json', import.meta.url),
  JSON.stringify(repaired, null, 2) + '\n');
console.log(`Wrote ${repaired.length} prospective question repairs`);
