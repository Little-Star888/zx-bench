import { describe, expect, it } from 'vitest';
import { parseMarkup, parseYamlDocuments, parseTomlDocument, parseMarkdownBlocks,
  parseMermaidStructure, tokenizeSql } from '../parsers/textStructure.js';
import { evaluateStructuredTextContract } from './structuredTextContracts.js';

const passed = (id: string, format: string, source: string) =>
  evaluateStructuredTextContract(id, format, source).every(check => check.pass);

describe('bounded text format parsing', () => {
  it('scopes YAML anchors to one document and parses nested arrays', () => {
    const good = `apiVersion: apps/v1
kind: Deployment
metadata: &defaultMeta
  name: one
  labels:
    app: one
    env: dev
spec:
  replicas: 1
  containers:
    - name: app
      image: nginx:1
  podMetadata: *defaultMeta
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: two
  labels:
    app: two
    env: prod
spec:
  replicas: 2
  containers:
    - name: app
      image: nginx:2`;
    expect(passed('SO-CN-032','yaml',good)).toBe(true);
    const bad = good.replace('  podMetadata: *defaultMeta\n','').replace('metadata:\n  name: two','metadata: *defaultMeta');
    expect(parseYamlDocuments(bad).errors).toContain('Undefined YAML alias defaultMeta');
    expect(passed('SO-CN-032','yaml',bad)).toBe(false);
    expect(parseYamlDocuments('test:unit:\n  stage: test\n  parallel: 2').value?.[0]).toEqual({ 'test:unit': { stage: 'test', parallel: 2 } });
  });

  it('checks TOML array tables and duplicate keys', () => {
    const valid = '[package]\nname = "demo"\n[[bin]]\nname = "one"\n[[bin]]\nname = "two"';
    expect(parseTomlDocument(valid).errors).toEqual([]);
    expect(parseTomlDocument(valid).value?.bin).toHaveLength(2);
    expect(parseTomlDocument('[package]\nname = "a"\nname = "b"').errors).toContain('Duplicate TOML key name');
  });

  it('rejects XML nesting and bare entities, then checks quote arithmetic', () => {
    expect(parseMarkup('<quote><buyer>x</quote></buyer>').errors.length).toBeGreaterThan(0);
    expect(parseMarkup('<quote><name>A & B</name></quote>').errors).toContain('Bare or invalid XML entity');
    const items = Array.from({ length: 12 }, (_, i) => `<item><sku>S${i}</sku><name>N${i}</name><qty>2</qty><unitPrice>1.50</unitPrice></item>`).join('');
    const good = `<?xml version="1.0" encoding="UTF-8"?><quote><quoteNo>Q1</quoteNo><buyer><name>北京机械 &amp; 电子有限公司</name></buyer><items>${items}</items><total>36.00</total></quote>`;
    expect(passed('SO-CN-049','xml',good)).toBe(true);
    expect(passed('SO-CN-049','xml',good.replace('36.00','35.00'))).toBe(false);
  });

  it('builds an HTML tree and rejects wrong nesting', () => {
    expect(parseMarkup('<html><head></head><body><table><tr><td>ok</td></tr></table></body></html>',true).errors).toEqual([]);
    expect(parseMarkup('<html><body><table></body></table></html>',true).errors.length).toBeGreaterThan(0);
  });

  it('recognizes Mermaid relationships and composite state transitions', () => {
    const er = 'erDiagram\nUser {\n int id\n}\nCourse {\n int id\n}\nUser ||--o{ Course : teaches';
    expect(parseMermaidStructure(er).value?.edges).toEqual([{ from: 'User', to: 'Course', label: 'teaches' }]);
    const state = 'stateDiagram-v2\nstate Installing {\n[*] --> Preparing : 开始\nPreparing --> Done : 完成\n}\nDone --> [*] : 结束';
    expect(parseMermaidStructure(state).errors).toEqual([]);
    expect(parseMermaidStructure(state).value?.edges).toHaveLength(3);
  });

  it('separates Markdown blocks from fenced code', () => {
    const markdown = '# 标题\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```sql\nSELECT 1;\n```';
    const parsed = parseMarkdownBlocks(markdown);
    expect(parsed.errors).toEqual([]);
    expect(parsed.value?.tables).toHaveLength(1);
    expect(parsed.value?.fences[0].language).toBe('sql');
    expect(parseMarkdownBlocks(markdown.slice(0,-3)).errors).toHaveLength(1);
  });

  it('removes SQL comments and strings from structural tokens', () => {
    const good = tokenizeSql("SELECT id FROM orders WHERE created_at >= '2024-03-01'; -- JOIN users");
    expect(good.value?.tokens.includes('JOIN')).toBe(false);
    expect(good.value?.tokens.includes('SELECT')).toBe(true);
    expect(tokenizeSql('SELECT (id FROM orders;').errors).toContain('Unbalanced SQL parentheses');
  });

  it('catches double-counted stock after a cumulative restock-log upsert', () => {
    const before = `WITH restock AS (
      INSERT INTO restock_log(product_id,warehouse_id,added_quantity)
      SELECT product_id,warehouse_id,8 FROM picked
      ON CONFLICT (product_id,warehouse_id) DO UPDATE
      SET added_quantity = restock_log.added_quantity + EXCLUDED.added_quantity
      RETURNING product_id,added_quantity
    ) UPDATE products p SET stock = p.stock + r.added_quantity
      FROM restock r WHERE p.product_id = r.product_id RETURNING p.stock`;
    const check = (sql: string) => evaluateStructuredTextContract('SO-CN-034','sql',sql)
      .find(item => item.label === 'stock increment does not reuse a cumulative conflict total')?.pass;
    expect(check(before)).toBe(false);
    expect(check(before.replace('restock_log.added_quantity + EXCLUDED.added_quantity',
      'EXCLUDED.added_quantity + restock_log.added_quantity'))).toBe(false);
    expect(check(before.replace('restock_log.added_quantity + EXCLUDED.added_quantity',
      'EXCLUDED.added_quantity'))).toBe(true);
    expect(check(before.replace('p.stock + r.added_quantity', 'p.stock + picked.added_quantity'))).toBe(true);
  });

  it('distinguishes the top three users from the top three orders', () => {
    const check = (sql: string) => evaluateStructuredTextContract('SO-CN-013','sql',sql)
      .find(item => item.label === 'city ranking selects distinct users rather than top orders')?.pass;
    const orders = `SELECT ROW_NUMBER() OVER (PARTITION BY u.city ORDER BY o.amount DESC)
      FROM orders o JOIN users u ON u.id=o.user_id`;
    expect(check(orders)).toBe(false);
    expect(check(orders.replace('PARTITION BY u.city', 'PARTITION BY u.id'))).toBe(true);
    expect(evaluateStructuredTextContract('SO-CN-013','sql',orders,'v1')
      .some(item => item.label === 'city ranking selects distinct users rather than top orders')).toBe(false);
  });

  it('requires Mermaid ER attributes to declare a type', () => {
    const fields: Record<string,string[]> = {
      User:['id','username','email','role'], Course:['id','title','instructor_id','price','category'],
      Enrollment:['id','user_id','course_id','enrolled_at','progress'],
      Lesson:['id','course_id','title','duration','order_num'],
      Payment:['id','user_id','course_id','amount','method','status'],
      Review:['id','user_id','course_id','rating','content'],
    };
    const diagram = (typed: boolean) => 'erDiagram\n' + Object.entries(fields)
      .map(([name,names]) => `${name} {\n${names.map(field => typed ? `string ${field}` : field).join('\n')}\n}`)
      .join('\n');
    const check = (source: string, version: 'v1' | 'v2') =>
      evaluateStructuredTextContract('SO-CN-024','mermaid',source,version)
        .find(item => item.label === 'ER attributes declare a type before each required field')?.pass;
    expect(check(diagram(false),'v2')).toBe(false);
    expect(check(diagram(true),'v2')).toBe(true);
    expect(check(diagram(false),'v1')).toBeUndefined();
  });

  it('checks MySQL declaration order and unsupported function calls', () => {
    const check = (source: string, label: string) =>
      evaluateStructuredTextContract('SO-CN-017','sql',source,'v2')
        .find(item => item.label === label)?.pass;
    const valid = 'CREATE PROCEDURE p() BEGIN DECLARE c CURSOR FOR SELECT id FROM products; DECLARE EXIT HANDLER FOR SQLEXCEPTION ROLLBACK; END';
    expect(check(valid,'MySQL cursor is declared before handlers')).toBe(true);
    expect(check(valid.replace('DECLARE c CURSOR FOR SELECT id FROM products; DECLARE EXIT HANDLER',
      'DECLARE EXIT HANDLER FOR SQLEXCEPTION ROLLBACK; DECLARE c CURSOR FOR SELECT id FROM products; --'),
    'MySQL cursor is declared before handlers')).toBe(false);
    expect(check(valid + ' SELECT ISOPEN(c), JSON_PARSE(x);',
      'procedure avoids unsupported ISOPEN and JSON_PARSE calls')).toBe(false);
  });
});
