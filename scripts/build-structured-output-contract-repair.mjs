// Development candidate: strengthen checks for twelve released questions without editing the bank.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { hashScenarioShort } from '../packages/core/dist/contracts/canonicalize.js';

const bank = JSON.parse(readFileSync('data/scenarios/benchmark.json', 'utf8'));
const ids = ['001','002','004','005','011','031','043','047','053','054','055','056'].map(x => `SO-CN-${x}`);
const outputPath = 'data/pilots/structured-output-contract-repair.json';
if (existsSync(outputPath)) {
  const previous = JSON.parse(readFileSync(outputPath, 'utf8'));
  if (previous.length === ids.length && previous.every(s => bank.find(x => x.id === s.id)?.scenarioHash === s.scenarioHash)) {
    console.log(JSON.stringify({ count: previous.length, alreadyReleased: true }));
    process.exit(0);
  }
}
const picked = new Map(ids.map(id => [id, structuredClone(bank.find(x => x.id === id))]));
const get = n => picked.get(`SO-CN-${n}`);
const add = (n, ...rules) => {
  const r = get(n).requirements;
  r.constraints = [...new Set([...(r.constraints ?? []), ...rules])];
};
const yes = (path, value) => `schemaAccepts:${path}=${JSON.stringify(value)}`;
const no = (path, value) => `schemaRejectsLiteral:${path}=${JSON.stringify(value)}`;

get('001').requirements.schema = {
  type: 'object', required: ['company_name','founded_date','address','departments'],
  properties: { company_name: { type: 'string' }, founded_date: { type: 'string' },
    address: { type: ['string','object'] }, departments: { type: 'array', minItems: 3, maxItems: 3,
      items: { type: 'object', required: ['name','leader','employee_count','projects'],
        properties: { name: { type: 'string' },
          employee_count: { type: 'integer' }, projects: { type: 'array', minItems: 2, maxItems: 3,
            items: { type: 'object', required: ['name','status'],
              properties: { name: { type: 'string' }, status: { type: 'string' } } } } } } } },
};
// The old scorer allowed company_name||name; the question explicitly requests company_name.
get('001').requirements.requiredFields[0] = 'company_name';

add('002', 'length:data=5', 'type:page=integer', 'type:pageSize=integer',
  'type:total=integer', 'type:totalPages=integer');

add('004', 'valueEq:properties.salary.minimum=3000',
  'valueEq:properties.salary.maximum=200000',
  'valueEq:properties.skills.minItems=1',
  'valueEq:properties.hire_date.format=date',
  'jsonSetEq:properties.department.enum=["技术部","产品部","市场部","人事部","财务部"]',
  'arrayContainsAll:required=["id","name","department","hire_date"]');

add('005', 'matches:name:"', 'matches:path:^[A-Za-z]:\\\\',
  'matches:description:\\n', 'matches:emoji:[\\u{1F300}-\\u{1FAFF}]',
  'matches:chinese:[《》【】「」]', 'matches:url:\\?',
  'matches:code:\\\\', 'matches:code:`', 'type:null_value=null', 'valueEq:empty_string=""');

add('011', 'jsonEq:headers=["产品名","描述","价格","标签"]',
  'minLength:rows=5', 'csvSomeCell:1:,', 'csvSomeCell:1:"',
  'csvSomeCell:3:;', 'csvAllCell:2:^\\d+\\.\\d{2}$');

const ticket = { id: '123e4567-e89b-12d3-a456-426614174000', tenantId: 'tenant-1',
  title: '工单', priority: 'low', status: 'open', assignee: null,
  tags: ['help'], createdAt: '2024-03-20T12:00:00Z', ticketNumber: 'TKT-100' };
get('031').promptTemplate += '\n根 Schema 自身定义 Ticket 对象；$defs.User 仅供 assignee 引用。';
add('031', yes('.', ticket), no('.', { ...ticket, priority: 'urgent' }),
  no('.', { ...ticket, tags: [] }), no('.', { ...ticket, ticketNumber: 'BAD-100' }),
  no('.', { ...ticket, assignee: 42 }));

const csvRows = [
  ['A-1','无线鼠标','静音, 便携, 支持蓝牙','129.00','12'],
  ['A-2','机械键盘','轴体为"青轴", 手感清脆','499.00','5'],
  ['A-3','显示器','尺寸 27 英寸\n分辨率 2560x1440','1899.00','3'],
  ['A-4','数据线','Type-C, 1.5 米','39.90','20'],
  ['A-5','支架','铝合金, 可升降','259.00','8'],
];
add('043', 'jsonEq:headers=["sku","name","desc","price","qty"]',
  `jsonEq:rows=${JSON.stringify(csvRows)}`);

for (const env of ['dev','staging','prod']) {
  add('047', `keys:config.environments.${env}.resources=cpu,memory`,
    `matches:config.environments.${env}.image:.+:.+`,
    `matches:config.environments.${env}.resources.cpu:.+`,
    `matches:config.environments.${env}.resources.memory:.+`);
}
add('047', 'valueEq:config.environments.dev.replicas=1',
  'valueEq:config.environments.staging.replicas=2',
  'type:config.environments.prod.replicas=integer',
  'atLeast:config.environments.prod.replicas=3',
  'matches:config.version:^\\d+\\.\\d+\\.\\d+$', 'nonempty:config.service');

get('053').promptTemplate = get('053').promptTemplate
  .replace('反推出**唯一一条判定规则**', '根据下面明确的业务规则构造 JSON Schema')
  .replace('提示：有且只有一条判定规则能同时解释全部 11 个样本。',
    '业务规则：sku 必须匹配 ^A-\\d+$；qty 必须是大于等于 10 的整数，不设上限。除这两项外不得添加范围或枚举限制。');
add('053', yes('schema', { sku: 'A-999', qty: 1000 }),
  yes('schema', { sku: 'A-1', qty: 10 }),
  no('schema', { sku: 'A-1', qty: 9 }),
  no('schema', { sku: 'A-1', qty: 10.5 }),
  no('schema', { sku: 'B-1', qty: 11 }));

add('054', yes('schema', { type: 'shape', radius: 1 }),
  yes('schema', { type: 'shape', side: 1 }),
  yes('schema', { type: 'text', value: 'ok' }),
  yes('schema', { type: 'shape', radius: 2 }),
  yes('schema', { type: 'shape', side: 2 }),
  no('schema', { type: 'shape', radius: 5, side: 5 }),
  no('schema', { type: 'shape', radius: 2, side: 2 }),
  no('schema', { type: 'text', value: 42 }));

const leaf = name => ({ name, weight: 0, children: [] });
add('055', yes('schema', { name: 'root', weight: 0, children: [leaf('a')] }),
  no('schema', { name: 'root', weight: 0, children: [leaf('a'),leaf('b'),leaf('c'),leaf('d'),leaf('e')] }),
  no('schema', { name: '', weight: 0, children: [] }),
  no('schema', { name: 'root', weight: -1, children: [] }));

add('056', 'keys:records[1]=emoji,spaced',
  'embeddedCsvHeaders:csv=["id","value"]', 'embeddedCsvRows:csv=3');

const repaired = ids.map(id => {
  const s = picked.get(id);
  const parts = s.scenarioVersion.split('.').map(Number);
  parts[2]++;
  s.scenarioVersion = parts.join('.');
  s.scenarioHash = hashScenarioShort(s);
  return s;
});
writeFileSync(outputPath, JSON.stringify(repaired, null, 2) + '\n');
console.log(JSON.stringify({ count: repaired.length, ids }));
