// Contract-only follow-up: repair objectively checkable requirements in existing questions.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const bank = JSON.parse(readFileSync('data/scenarios/benchmark.json', 'utf8'));
const ids = ['003','006','007','009','028','029','030','040','044','046','048','050','051','058','059'].map(n => `SO-CN-${n}`);
const outputPath = 'data/pilots/structured-output-contract-repair-v2.json';
if (existsSync(outputPath)) {
  const previous = JSON.parse(readFileSync(outputPath, 'utf8'));
  if (previous.length === ids.length && previous.every(s => bank.find(x => x.id === s.id)?.scenarioHash === s.scenarioHash)) {
    console.log(JSON.stringify({ count: previous.length, alreadyReleased: true }));
    process.exit(0);
  }
}
const picked = new Map(ids.map(id => [id, structuredClone(bank.find(s => s.id === id))]));
const get = n => picked.get(`SO-CN-${n}`);
const add = (n, ...rules) => {
  const requirements = get(n).requirements;
  requirements.constraints = [...new Set([...(requirements.constraints ?? []), ...rules])];
};

add('003', 'minLength:items=3', 'keysAll:items[]=sku_id,name,quantity,unit_price,subtotal',
  'productEq:items[].subtotal=quantity*unit_price:2', 'sumEq:items[].subtotal=**.items_total:0.001',
  'maxDecimals:items[].unit_price=2', 'maxDecimals:items[].subtotal=2',
  'required:buyer.name', 'required:buyer.phone', 'required:buyer.address.province',
  'required:buyer.address.city', 'required:buyer.address.district', 'required:buyer.address.street',
  'required:payment.transaction_id', 'required:updated_at');

const uuid = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
get('006').requirements.schema = { type: 'object', required: ['data','extensions'],
  properties: {
    data: { type: 'object', required: ['user'], properties: { user: { type: 'object',
      required: ['id','username','email','profile','orders'], properties: {
        id: { type: 'string', pattern: uuid }, username: { type: 'string' }, email: { type: 'string' },
        profile: { type: 'object', required: ['avatar','bio'] },
        orders: { type: 'array', minItems: 3, items: { type: 'object',
          required: ['id','items','total','status'], properties: {
            id: { type: 'string', pattern: uuid }, items: { type: 'array', items: { type: 'object',
              properties: { productId: { type: 'string', pattern: uuid }, id: { type: 'string', pattern: uuid } } } },
            total: { type: 'number' }, status: { type: 'string' },
          } } },
      } } } },
    extensions: { type: 'object', required: ['tracing'], properties: { tracing: { type: 'object',
      required: ['duration','startTime'], properties: { duration: { type: 'number' }, startTime: { type: 'string' } } } } },
  } };
add('006', `matches:data.user.id:${uuid}`, `reAll:data.user.orders[].id:${uuid}`,
  `nestedOptionalMatch:data.user.orders[].items.productId:${uuid}`,
  `nestedOptionalMatch:data.user.orders[].items.id:${uuid}`);

add('007', 'csvSalesFixture');

add('009', 'jsonEq:headers=["工号","姓名","部门","职位","入职日期","月薪","手机号"]',
  'length:rows=10', `csvColumnSetEq:0=${JSON.stringify(Array.from({ length: 10 }, (_, i) => `EMP${String(i + 1).padStart(3, '0')}`))}`,
  'csvCellCount:2:技术部:>=2', 'csvCellCount:2:产品部:>=2', 'csvCellCount:2:市场部:>=2',
  'csvAllCell:4:^\\d{4}-\\d{2}-\\d{2}$', 'csvAllCell:5:^\\d+$',
  'csvNumericRange:5:8000:35000', 'csvAllCell:6:^\\d{11}$');

get('028').promptTemplate = get('028').promptTemplate.replace('中国身份证号（18位，含校验位）',
  '中国身份证号（18位格式，末位为数字或 X；只检验格式，不要求计算真实校验和）');
get('028').requirements.schema = { type: 'object', required: ['patterns'],
  properties: { patterns: { type: 'array', minItems: 5, maxItems: 5, items: { type: 'object',
    required: ['name','regex','description','examples','non_examples'], properties: {
      name: { type: 'string' }, regex: { type: 'string' }, description: { type: 'string' },
      examples: { type: 'array', minItems: 2 }, non_examples: { type: 'array', minItems: 1 },
    } } } } };
add('028', 'regexPatternFixtures');

add('029', 'minProperties:dependencies=3', 'minProperties:devDependencies=2',
  'matches:description:[\u4e00-\u9fff]', 'matches:version:^\\d+\\.\\d+\\.\\d+',
  'nonempty:scripts.dev', 'nonempty:scripts.build', 'nonempty:scripts.test',
  'nonempty:engines.node', 'nonempty:license');

const envSchema = { type: 'object', required: ['replicas','resources','env','healthCheck'], properties: {
  replicas: { type: 'integer' }, resources: { type: 'object', required: ['cpu','memory'],
    properties: { cpu: { type: 'string', pattern: '^\\d+m$' }, memory: { type: 'string' } } },
  env: { type: 'object', minProperties: 2 }, healthCheck: { type: 'object',
    required: ['path','intervalSeconds','timeoutSeconds'], properties: {
      path: { type: 'string' }, intervalSeconds: { type: 'integer' }, timeoutSeconds: { type: 'integer' } } },
  description: { type: 'string' },
} };
get('030').requirements.schema = { type: 'object', required: ['service','version','environments','defaultEnvironment'],
  properties: { environments: { type: 'object', required: ['development','staging','production'],
    properties: Object.fromEntries(['development','staging','production'].map(name => [name, envSchema])) },
    defaultEnvironment: { type: 'string', enum: ['development','staging','production'] } } };
add('030', `someStringContainsAll:.=${JSON.stringify(['"', '\\', '\n'])}`);

add('040', 'valueEq:runNumber=1287', 'valueEq:branch=main', 'valueEq:triggeredBy=alice',
  'valueEq:durationSeconds=342', 'length:jobs=3',
  'arrayLookupEq:jobs[].name={"build":{"status":"success"},"test":{"status":"failed"},"deploy":{"status":"skipped"}}',
  'matches:aiSummary:[\u4e00-\u9fff]', 'matches:aiSummary:(test|测试)',
  'valueEq:overallStatus=failed');

const inventory = { sku: 'SKU-1234', name: '零件', quantity: 0, unitPrice: 0.01,
  warehouse: 'BJ', updatedAt: '2026-03-01T00:00:00Z' };
add('044', 'valueEq:schema.additionalProperties=false',
  'keys:schema.properties=sku,name,quantity,unitPrice,warehouse,updatedAt',
  'jsonSetEq:schema.required=["sku","name","quantity","unitPrice","warehouse","updatedAt"]',
  'valueEq:schema.properties.sku.type=string',
  'valueEq:schema.properties.quantity.type=integer', 'valueEq:schema.properties.quantity.minimum=0',
  'valueEq:schema.properties.unitPrice.type=number', 'valueEq:schema.properties.unitPrice.minimum=0.01',
  'jsonSetEq:schema.properties.warehouse.enum=["BJ","SH","GZ"]',
  'valueEq:schema.properties.updatedAt.format=date-time',
  `schemaAccepts:schema=${JSON.stringify(inventory)}`,
  `schemaRejectsLiteral:schema=${JSON.stringify({ ...inventory, sku: 'BAD' })}`,
  `schemaRejectsLiteral:schema=${JSON.stringify({ ...inventory, quantity: -1 })}`,
  `schemaRejectsLiteral:schema=${JSON.stringify({ ...inventory, unitPrice: 0 })}`,
  `schemaRejectsLiteral:schema=${JSON.stringify({ ...inventory, warehouse: 'SZ' })}`);

get('046').promptTemplate = get('046').promptTemplate.replace('2025-01 至 2026-06', '2025-01 至 2027-06');
const months = Array.from({ length: 30 }, (_, i) => `${2025 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`);
add('046', 'valueEq:currency=CNY', 'nonempty:accountId',
  `arraySequence:ledger[].month=${JSON.stringify(months)}`,
  'notValueAll:ledger[].delta=0', 'minAll:ledger[].closingBalance=0',
  'maxDecimals:ledger[].openingBalance=2');

add('048', 'valueEq:page=2', 'valueEq:pageSize=20', 'valueEq:total=57', 'valueEq:totalPages=3',
  `arraySequence:items[].id=${JSON.stringify(Array.from({ length: 20 }, (_, i) => i + 21))}`,
  'arrayMappedCode:items[].code=id:ITEM-:4', 'minAll:items[].amount=0.01',
  'jsonSetEq:schema.required=["id","code","amount","createdAt"]',
  'valueEq:schema.additionalProperties=false',
  'keys:schema.properties=id,code,amount,createdAt',
  'valueEq:schema.properties.id.type=integer', 'valueEq:schema.properties.id.minimum=21',
  'valueEq:schema.properties.id.maximum=40', 'valueEq:schema.properties.amount.type=number',
  'valueEq:schema.properties.amount.minimum=0.01',
  'schemaValidatesAll:schema:items');

add('050', 'setEquals:accounts[].id=ACC-01,ACC-02,ACC-03,ACC-04',
  `arraySequence:transactions[].txId=${JSON.stringify(Array.from({ length: 120 }, (_, i) => `TX-${String(i + 1).padStart(4, '0')}`))}`,
  'keys:summary=count,totalAmount,totalFee,totalNet', 'valueEq:summary.count=120',
  'minAll:transactions[].amount=0.01', 'differenceEq:transactions[].net=amount-fee');

add('051', 'nestedLength:months[].departments=5',
  'nestedFields:months[].departments=name,budget,spent,remaining',
  'nestedSequence:months[].departments.name=["研发","市场","销售","运营","财务"]',
  'nestedPositive:months[].departments.budget', 'nestedPositive:months[].departments.spent',
  'nestedMaxDecimals:months[].departments.budget=2', 'nestedMaxDecimals:months[].departments.spent=2',
  'nestedMaxDecimals:months[].departments.remaining=2',
  'nestedDifference:months[].departments.remaining=budget-spent',
  'nestedSum:months[].departments.budget=budgetTotal',
  'nestedSum:months[].departments.spent=spentTotal',
  `arraySequence:months[].month=${JSON.stringify(Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`))}`);

get('058').requirements.schema.properties.items = { type: 'array', minItems: 6, maxItems: 6,
  items: { type: 'object', required: ['sku','amount','flag','status','note'],
    additionalProperties: false, properties: {
      sku: { type: 'string' }, amount: { type: 'integer', multipleOf: 25 },
      flag: { type: 'boolean' }, status: { enum: ['ok','bad'] }, note: { type: 'string' },
    } } };

add('059', `arraySequence:notes[].id=${JSON.stringify(['N1','N2','N3','N4','N5','N6'])}`);

const candidates = ids.map(id => {
  const scenario = picked.get(id);
  const version = scenario.scenarioVersion.split('.').map(Number);
  version[2]++;
  scenario.scenarioVersion = version.join('.');
  scenario.scenarioHash = hashScenarioShort(scenario);
  return scenario;
});
writeFileSync(outputPath, JSON.stringify(candidates, null, 2) + '\n');
console.log(JSON.stringify({ count: candidates.length, ids }));
