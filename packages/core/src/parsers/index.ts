// ============================================================
// 格式专用解析器（GPT5.6 结构化输出 P1-2）
// JSON / YAML / CSV / XML / SQL / HTML / Mermaid / Regex
// 每种解析器返回统一的 FormatParseResult
//
// v4 修复（结构化输出维度评审）：
//  1. 围栏剥离改为「整份输出就是一个围栏块」才生效；否则取第一个围栏体并标记 fenced，
//     markdown 例外（文档本身可以合法包含多个围栏）。
//  2. JSON 支持「平衡扫描提取最外层值」，模型在 JSON 后附解释句不再导致整段不可解析。
//  3. CSV 尾部散文（空行/单列行）截断为 trailing_content 警告，不再被当成数据行报列数错误。
//  4. XML 标签配对支持命名空间前缀（<soap:Body>）并正确排除自闭合标签。
//  5. Mermaid erDiagram 的基数记法（||--o{）不再被误判为未闭合括号。
//
// 违规类型约定：schema_mismatch / missing_required 属于「内容」违规，
// 不参与语法轴扣分（见 CONTENT_VIOLATION_TYPES）。
// ============================================================

import type { FormatParseResult, FormatViolation } from '@zxbench/types';

/** 内容类违规：由 schema / 字段轴消费，不计入语法轴。 */
export const CONTENT_VIOLATION_TYPES = new Set(['schema_mismatch', 'missing_required']);

/** 尾部/外部冗余文本（围栏、解释句）标记，由输出纪律轴消费。 */
export const TRAILING_CONTENT_VIOLATION = 'trailing_content';

/** 该违规是否属于「语法/结构」错误（即应当扣 syntax_parse 的错误）。 */
export function isSyntaxViolation(violation: FormatViolation): boolean {
  return violation.severity === 'error' && !CONTENT_VIOLATION_TYPES.has(violation.type);
}

// ===== 通用：围栏与载荷提取 =====

export interface FormatPayload {
  /** 用于内容校验的正文（已按格式规则剥离围栏） */
  text: string;
  /** 正文来自围栏内部 */
  fenced: boolean;
  /** 围栏之外还存在非正文内容 */
  trailing: boolean;
}

const WHOLE_FENCE_RE = /^```([\w-]*)[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;
const ANY_FENCE_RE = /```([\w-]*)[ \t]*\r?\n([\s\S]*?)```/;

/**
 * 提取某格式的正文载荷。
 * - 整份输出恰好是一个围栏块 → 取围栏内容，fenced=true，trailing=false
 * - 否则若存在围栏 → 取第一个围栏内容，fenced=true，trailing=true
 * - 无围栏 → 取全文，fenced=false，trailing=false
 * markdown 例外：只有「整份输出就是一个围栏块」才剥离，因为文档内可以合法包含围栏。
 */
export function extractFormatPayload(format: string, content: string): FormatPayload {
  const trimmed = content.trim();
  const whole = trimmed.match(WHOLE_FENCE_RE);
  if (whole) return { text: whole[2].trim(), fenced: true, trailing: false };
  if (format === 'markdown') return { text: trimmed, fenced: false, trailing: false };

  const any = trimmed.match(ANY_FENCE_RE);
  if (any) {
    const covered = any[0].length;
    return { text: any[2].trim(), fenced: true, trailing: covered < trimmed.length };
  }
  return { text: trimmed, fenced: false, trailing: false };
}

// ===== JSON 解析器 =====

/**
 * 定位文本中最可几的「载荷」JSON 值，用于容忍模型在 JSON 前后附加自然语言解释。
 *
 * 算法（2026-09-16 收紧）：
 *  1. 从左到右切出**互不嵌套**的平衡区段（遇到闭合即记录，并跳过其内部）；
 *  2. 在长度 ≥ 最大区段一半的候选里，按长度降序取第一个能被 JSON.parse 接受的。
 *
 * 为什么不是「取第一个能解析的片段」：那样会把 `{"page":1,,"data":[]}` 这种
 * 真正损坏的对象降级成内嵌的 `[]` 而被判为解析成功（假阳性），
 * 也会把说明文字里的 `{}` 误当成载荷。长度下界保证载荷是主体区段。
 */
export function extractFirstJsonValue(content: string): { value: string; start: number; end: number } | null {
  const regions: Array<{ value: string; start: number; end: number }> = [];

  let cursor = 0;
  while (cursor < content.length) {
    const first = content[cursor];
    if (first !== '{' && first !== '[') { cursor++; continue; }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let closed = -1;
    for (let j = cursor; j < content.length; j++) {
      const ch = content[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) { closed = j; break; }
      }
    }

    if (closed < 0) { cursor++; continue; }
    regions.push({ value: content.slice(cursor, closed + 1), start: cursor, end: closed + 1 });
    cursor = closed + 1;
  }

  if (regions.length === 0) return null;

  let largest = regions[0];
  for (const region of regions) if (region.value.length > largest.value.length) largest = region;
  const minLength = Math.max(2, Math.floor(largest.value.length / 2));

  for (const region of [...regions].sort((a, b) => b.value.length - a.value.length)) {
    if (region.value.length < minLength) break;
    try {
      JSON.parse(region.value);
      return region;
    } catch {
      // 该区段不是合法 JSON，继续尝试次长的候选
    }
  }
  return null;
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON' };
  }
}

export function parseJSON(
  content: string,
  schema?: Record<string, unknown>,
): FormatParseResult {
  const violations: FormatViolation[] = [];

  const strict = tryParseJson(content.trim());
  if (strict.ok) {
    const outcome = schema ? validateJsonSchema(strict.value, schema) : NO_SCHEMA_OUTCOME;
    violations.push(...outcome.violations);
    return {
      format: 'json',
      success: !violations.some(isSyntaxViolation),
      parsed: strict.value,
      violations,
      schemaChecks: outcome.checks,
    };
  }

  // 兜底 1：整份输出被 markdown 围栏包裹
  const fenced = content.trim().match(WHOLE_FENCE_RE);
  if (fenced) {
    const inner = tryParseJson(fenced[2].trim());
    if (inner.ok) {
      // 整份输出就是一个围栏块：围栏外没有内容，仅由输出纪律轴按 policy 判定，不在此报尾部冗余
      const outcome = schema ? validateJsonSchema(inner.value, schema) : NO_SCHEMA_OUTCOME;
      violations.push(...outcome.violations);
      return { format: 'json', success: true, parsed: inner.value, violations, schemaChecks: outcome.checks };
    }
  }

  // 兜底 2：从文本中平衡扫描出最外层 JSON 值（容忍前后解释句）
  const found = extractFirstJsonValue(content.trim());
  if (found) {
    const extracted = tryParseJson(found.value);
    if (extracted.ok) {
      const outside = `${content.trim().slice(0, found.start)}${content.trim().slice(found.end)}`.trim();
      violations.push({
        type: TRAILING_CONTENT_VIOLATION,
        message: `Non-JSON text surrounds the JSON value (${outside.length} chars outside)`,
        severity: 'warning',
      });
      const outcome = schema ? validateJsonSchema(extracted.value, schema) : NO_SCHEMA_OUTCOME;
      violations.push(...outcome.violations);
      return { format: 'json', success: true, parsed: extracted.value, violations, schemaChecks: outcome.checks };
    }
  }

  violations.push({ type: 'parse_error', message: strict.error, severity: 'error' });
  return { format: 'json', success: false, violations };
}

const NO_SCHEMA_OUTCOME: SchemaOutcome = { violations: [], checks: 0 };

interface SchemaOutcome {
  violations: FormatViolation[];
  checks: number;
}

/**
 * JSON Schema 校验（2026-09-16 扩展，原为 MVP 仅查 type/required/properties）。
 *
 * 背景：题集把格式要求写进 `requirements.schema`，但旧实现只认三个关键字，
 * 题面明写的 `oneOf` / `pattern` / `format` / `enum` / `minItems` / `$defs` 一律不生效，
 * 导致「按 declared schema 打分」的 schema 轴形同虚设，难度被系统性削弱。
 *
 * 设计约束：
 * - 只对**已实现**的关键字产出违规；未知关键字一律跳过（不臆断），并计入 checks 分母。
 * - `checks` 用于按覆盖率折算计分，避免约束多的题被一刀切扣成 0。
 * - 无效正则等无法判定的情况不计入 checks（视为未测量）。
 */
const JSON_SCHEMA_FORMAT_PATTERNS: Record<string, RegExp> = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:?\d{2})?$/,
  'date-time': /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:?\d{2})?$/,
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
};

function resolveSchemaRef(root: Record<string, unknown>, ref: string): Record<string, unknown> | null {
  if (!ref.startsWith('#/')) return null;
  let current: unknown = root;
  for (const rawPart of ref.slice(2).split('/')) {
    if (current === null || typeof current !== 'object') return null;
    const key = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
    current = (current as Record<string, unknown>)[key];
  }
  return current !== null && typeof current === 'object' ? (current as Record<string, unknown>) : null;
}

function actualJsonType(data: unknown): string {
  if (data === null) return 'null';
  if (Array.isArray(data)) return 'array';
  return typeof data;
}

function validateJsonSchema(
  data: unknown,
  schema: Record<string, unknown>,
  rootSchema?: Record<string, unknown>,
  depth = 0,
): SchemaOutcome {
  const root = rootSchema ?? schema;
  const violations: FormatViolation[] = [];
  let checks = 0;
  const fail = (message: string) => violations.push({ type: 'schema_mismatch', message, severity: 'error' });
  const missing = (message: string) => violations.push({ type: 'missing_required', message, severity: 'error' });

  if (depth > 20) return { violations, checks };

  if (typeof schema.$ref === 'string') {
    const resolved = resolveSchemaRef(root, schema.$ref);
    return resolved ? validateJsonSchema(data, resolved, root, depth + 1) : { violations, checks };
  }

  if (schema.type !== undefined) {
    const types = (Array.isArray(schema.type) ? schema.type : [schema.type]).map(String);
    if (types.length > 0) {
      checks++;
      const actual = actualJsonType(data);
      const ok = types.some((t) =>
        t === actual || (t === 'integer' && typeof data === 'number' && Number.isInteger(data)));
      if (!ok) fail(`Expected type "${types.join('|')}" but got "${actual}"`);
    }
  }

  if ('const' in schema) {
    checks++;
    if (data !== schema.const) fail(`Expected const ${JSON.stringify(schema.const)} but got ${JSON.stringify(data)}`);
  }
  if (Array.isArray(schema.enum)) {
    checks++;
    if (!schema.enum.some((candidate) => candidate === data)) {
      fail(`Value ${JSON.stringify(data)} is not one of [${schema.enum.map((v) => JSON.stringify(v)).join(', ')}]`);
    }
  }

  if (typeof data === 'string') {
    if (typeof schema.minLength === 'number') {
      checks++;
      if (data.length < schema.minLength) fail(`String length ${data.length} is below minLength ${schema.minLength}`);
    }
    if (typeof schema.maxLength === 'number') {
      checks++;
      if (data.length > schema.maxLength) fail(`String length ${data.length} exceeds maxLength ${schema.maxLength}`);
    }
    if (typeof schema.pattern === 'string') {
      try {
        const pattern = new RegExp(schema.pattern);
        checks++;
        if (!pattern.test(data)) fail(`String does not match pattern ${schema.pattern}`);
      } catch {
        // 无效正则：无法判定，不计入 checks（未测量）
      }
    }
    if (typeof schema.format === 'string') {
      const formatPattern = JSON_SCHEMA_FORMAT_PATTERNS[schema.format];
      if (formatPattern) {
        checks++;
        if (!formatPattern.test(data)) fail(`String does not match format "${schema.format}"`);
      }
    }
  }

  if (typeof data === 'number') {
    if (typeof schema.minimum === 'number') {
      checks++;
      if (data < schema.minimum) fail(`Number ${data} is below minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number') {
      checks++;
      if (data > schema.maximum) fail(`Number ${data} exceeds maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(data)) {
    if (typeof schema.minItems === 'number') {
      checks++;
      if (data.length < schema.minItems) fail(`Array length ${data.length} is below minItems ${schema.minItems}`);
    }
    if (typeof schema.maxItems === 'number') {
      checks++;
      if (data.length > schema.maxItems) fail(`Array length ${data.length} exceeds maxItems ${schema.maxItems}`);
    }
    if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
      for (const item of data) {
        const sub = validateJsonSchema(item, schema.items as Record<string, unknown>, root, depth + 1);
        violations.push(...sub.violations);
        checks += sub.checks;
      }
    }
  }

  if (Array.isArray(schema.oneOf)) {
    checks++;
    const branches = schema.oneOf.map((sub) =>
      validateJsonSchema(data, sub as Record<string, unknown>, root, depth + 1).violations.length === 0);
    const matched = branches.filter(Boolean).length;
    if (matched !== 1) fail(`oneOf matched ${matched} subschema(s), expected exactly 1`);
  }
  if (Array.isArray(schema.anyOf)) {
    checks++;
    const matched = schema.anyOf.some((sub) =>
      validateJsonSchema(data, sub as Record<string, unknown>, root, depth + 1).violations.length === 0);
    if (!matched) fail('anyOf matched no subschema');
  }
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      const outcome = validateJsonSchema(data, sub as Record<string, unknown>, root, depth + 1);
      violations.push(...outcome.violations);
      checks += outcome.checks;
    }
  }

  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const node = data as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        checks++;
        if (!(key in node)) missing(`Missing required field: "${key}"`);
      }
    }
    if (schema.properties && typeof schema.properties === 'object') {
      const declared = new Set(Object.keys(schema.properties as Record<string, unknown>));
      // additionalProperties:false 时逐个暴露多余键——模型「顺手多加字段」是最常见的
      // 结构违规之一，不检查等于放弃了这类区分度。
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(node)) {
          checks++;
          if (!declared.has(key)) fail(`Unexpected property "${key}" (additionalProperties:false)`);
        }
      }
      for (const [key, propSchema] of Object.entries(schema.properties as Record<string, unknown>)) {
        if (!(key in node)) continue;
        const outcome = validateJsonSchema(node[key], propSchema as Record<string, unknown>, root, depth + 1);
        violations.push(...outcome.violations.map((v) => ({ ...v, message: `[${key}] ${v.message}` })));
        checks += outcome.checks;
      }
    }
  }

  return { violations, checks };
}

/** 供结构化输出断言复用：统计实例相对给定 schema 的违规数（0 = 通过）。 */
export function countSchemaViolations(instance: unknown, schema: Record<string, unknown>): number {
  return validateJsonSchema(instance, schema).violations.length;
}

// ===== CSV 解析器（RFC 4180） =====

/** 统计一行包含的字段数（考虑引号转义），并返回该行结束时是否仍处于引号内。 */
function scanCsvLine(line: string, startInQuotes: boolean): { fields: number; endsInQuotes: boolean } {
  let fields = 1;
  let inQuotes = startInQuotes;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') i++;
        else inQuotes = false;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields++;
    }
  }
  if (startInQuotes) fields = 0; // 引号内的续行不单独计字段
  return { fields, endsInQuotes: inQuotes };
}

/**
 * 切分 CSV 主体与尾部散文。
 * 模型常见行为：先给完整 CSV，空一行后追加「推理过程：...」。
 * 这些行只有 1 个字段，若当作数据行会产生大量列数不匹配的假错误。
 */
function splitCsvBodyAndTrailing(csv: string): { body: string; trailing: string | null } {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return { body: csv, trailing: null };

  const headerScan = scanCsvLine(lines[0], false);
  const expected = headerScan.fields;
  let inQuotes = headerScan.endsInQuotes;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const scan = scanCsvLine(line, inQuotes);
    const wasInsideQuotes = inQuotes;
    inQuotes = scan.endsInQuotes;

    if (wasInsideQuotes) continue; // 多行字段内部
    if (inQuotes) continue;        // 进入多行字段

    if (line.trim() === '') {
      return { body: lines.slice(0, i).join('\n'), trailing: lines.slice(i).join('\n') };
    }
    if (expected > 1 && scan.fields === 1) {
      return { body: lines.slice(0, i).join('\n'), trailing: lines.slice(i).join('\n') };
    }
  }
  return { body: csv, trailing: null };
}

export function parseCSV(
  content: string,
  options?: { expectedColumns?: string[]; minRows?: number; maxRows?: number },
): FormatParseResult {
  const violations: FormatViolation[] = [];

  const payload = extractFormatPayload('csv', content);
  if (payload.trailing) {
    violations.push({
      type: TRAILING_CONTENT_VIOLATION,
      message: 'CSV body is fenced and extra text exists outside the fence',
      severity: 'warning',
    });
  }

  const { body, trailing } = splitCsvBodyAndTrailing(payload.text);
  if (trailing) {
    const count = trailing.split(/\r?\n/).filter((l) => l.trim() !== '').length;
    violations.push({
      type: TRAILING_CONTENT_VIOLATION,
      message: `Discarded ${count} trailing non-CSV line(s)`,
      severity: 'warning',
    });
  }

  try {
    const rows = parseCSVRows(body);

    if (rows.length === 0) {
      violations.push({ type: 'empty_content', message: 'CSV is empty', severity: 'error' });
      return { format: 'csv', success: false, violations };
    }

    const headers = rows[0];

    // 列数一致性检查
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].length !== headers.length) {
        violations.push({
          type: 'column_mismatch',
          message: `Row ${i + 1} has ${rows[i].length} columns, expected ${headers.length}`,
          severity: 'error',
        });
      }
    }

    // 期望列名检查
    if (options?.expectedColumns) {
      for (const col of options.expectedColumns) {
        if (!headers.includes(col)) {
          violations.push({
            type: 'missing_column',
            message: `Expected column "${col}" not found in headers`,
            severity: 'error',
          });
        }
      }
    }

    // 行数检查
    if (options?.minRows && rows.length - 1 < options.minRows) {
      violations.push({
        type: 'insufficient_rows',
        message: `Expected at least ${options.minRows} rows, got ${rows.length - 1}`,
        severity: 'warning',
      });
    }
    if (options?.maxRows && rows.length - 1 > options.maxRows) {
      violations.push({
        type: 'excess_rows',
        message: `Expected at most ${options.maxRows} rows, got ${rows.length - 1}`,
        severity: 'warning',
      });
    }

    return {
      format: 'csv',
      success: violations.filter(isSyntaxViolation).length === 0,
      parsed: { headers, rows: rows.slice(1) },
      violations,
    };
  } catch (err) {
    violations.push({
      type: 'parse_error',
      message: err instanceof Error ? err.message : 'Invalid CSV',
      severity: 'error',
    });
    return { format: 'csv', success: false, violations };
  }
}

/** RFC 4180 CSV 解析 */
function parseCSVRows(input: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(current.trim());
        current = '';
      } else if (char === '\n' || (char === '\r' && next === '\n')) {
        row.push(current.trim());
        if (row.some((cell) => cell !== '')) rows.push(row);
        row = [];
        current = '';
        if (char === '\r') i++;
      } else {
        current += char;
      }
    }
  }

  // 最后一行
  row.push(current.trim());
  if (row.some((cell) => cell !== '')) rows.push(row);

  return rows;
}

// ===== XML 解析器 =====

const XML_TAG_RE = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;

export function parseXML(content: string): FormatParseResult {
  const violations: FormatViolation[] = [];

  const payload = extractFormatPayload('xml', content);
  const xmlStr = payload.text;
  if (payload.trailing) {
    violations.push({
      type: TRAILING_CONTENT_VIOLATION,
      message: 'XML body is fenced and extra text exists outside the fence',
      severity: 'warning',
    });
  }

  // 基础 XML 格式检查
  if (!xmlStr.startsWith('<?xml') && !xmlStr.startsWith('<')) {
    violations.push({
      type: 'parse_error',
      message: 'Content does not appear to be XML',
      severity: 'error',
    });
    return { format: 'xml', success: false, violations };
  }

  // 标签配对检查：支持命名空间前缀（<soap:Body>），排除自闭合（<rect ... />）
  const openCount: Record<string, number> = {};
  const closeCount: Record<string, number> = {};
  XML_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = XML_TAG_RE.exec(xmlStr)) !== null) {
    const closing = match[1] === '/';
    const name = match[2];
    const attrs = match[3] ?? '';
    if (closing) {
      closeCount[name] = (closeCount[name] ?? 0) + 1;
      continue;
    }
    const selfClosing = /\/\s*$/.test(attrs);
    if (!selfClosing) openCount[name] = (openCount[name] ?? 0) + 1;
  }

  for (const [name, count] of Object.entries(openCount)) {
    const balance = count - (closeCount[name] ?? 0);
    if (balance > 0) {
      violations.push({
        type: 'unclosed_tag',
        message: `Tag "${name}" is not properly closed (${balance} unclosed)`,
        severity: 'error',
      });
    }
  }
  for (const [name, count] of Object.entries(closeCount)) {
    const balance = (openCount[name] ?? 0) - count;
    if (balance < 0) {
      violations.push({
        type: 'extra_close_tag',
        message: `Tag "${name}" has ${-balance} extra closing tags`,
        severity: 'error',
      });
    }
  }

  return {
    format: 'xml',
    success: violations.filter(isSyntaxViolation).length === 0,
    parsed: xmlStr,
    violations,
  };
}

// ===== SQL 解析器（基础语法检查） =====

export function parseSQL(content: string): FormatParseResult {
  const violations: FormatViolation[] = [];

  const payload = extractFormatPayload('sql', content);
  const sqlStr = payload.text;
  if (payload.trailing) {
    violations.push({
      type: TRAILING_CONTENT_VIOLATION,
      message: 'SQL body is fenced and extra text exists outside the fence',
      severity: 'warning',
    });
  }

  // 基础 SQL 语法检查
  const statements = sqlStr.split(';').map((s) => s.trim()).filter((s) => s.length > 0);

  if (statements.length === 0) {
    violations.push({ type: 'empty_content', message: 'No SQL statements found', severity: 'error' });
    return { format: 'sql', success: false, violations };
  }

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const firstWord = stmt.replace(/^(?:\s*--[^\n]*\n)+/, '').split(/\s+/)[0]?.toUpperCase();

    const validKeywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'WITH', 'EXPLAIN', 'SHOW', 'DESCRIBE', 'SET', 'USE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'DECLARE', 'DELIMITER', 'GRANT', 'REVOKE', 'TRUNCATE', 'CALL'];
    if (firstWord && !validKeywords.includes(firstWord)) {
      violations.push({
        type: 'invalid_syntax',
        message: `Statement ${i + 1}: unexpected keyword "${firstWord}"`,
        severity: 'warning',
      });
    }

    // 检查括号平衡
    let parenDepth = 0;
    for (const char of stmt) {
      if (char === '(') parenDepth++;
      if (char === ')') parenDepth--;
      if (parenDepth < 0) {
        violations.push({
          type: 'unmatched_paren',
          message: `Statement ${i + 1}: unmatched closing parenthesis`,
          severity: 'error',
        });
        break;
      }
    }
    if (parenDepth > 0) {
      violations.push({
        type: 'unmatched_paren',
        message: `Statement ${i + 1}: ${parenDepth} unclosed parenthesis`,
        severity: 'error',
      });
    }
  }

  return {
    format: 'sql',
    success: violations.filter(isSyntaxViolation).length === 0,
    parsed: statements,
    violations,
  };
}

// ===== HTML 解析器 =====

export function parseHTML(content: string): FormatParseResult {
  const violations: FormatViolation[] = [];

  const payload = extractFormatPayload('html', content);
  const htmlStr = payload.text;
  if (payload.trailing) {
    violations.push({
      type: TRAILING_CONTENT_VIOLATION,
      message: 'HTML body is fenced and extra text exists outside the fence',
      severity: 'warning',
    });
  }

  // 基础 HTML 结构检查
  const hasDoctype = htmlStr.toLowerCase().startsWith('<!doctype');
  const hasHtmlTag = /<html[\s>]/i.test(htmlStr);
  const hasHeadTag = /<head[\s>]/i.test(htmlStr);
  const hasBodyTag = /<body[\s>]/i.test(htmlStr);

  if (!hasDoctype) {
    violations.push({ type: 'missing_structure', message: 'Missing DOCTYPE declaration', severity: 'warning' });
  }
  if (!hasHtmlTag) {
    violations.push({ type: 'missing_structure', message: 'Missing <html> tag', severity: 'warning' });
  }
  if (!hasHeadTag) {
    violations.push({ type: 'missing_structure', message: 'Missing <head> tag', severity: 'warning' });
  }
  if (!hasBodyTag) {
    violations.push({ type: 'missing_structure', message: 'Missing <body> tag', severity: 'warning' });
  }

  // 标签闭合检查（简化版）
  const voidElements = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
  const openTags = (htmlStr.match(/<([a-zA-Z][a-zA-Z0-9]*)[^>]*(?<!\/)>/g) || [])
    .map((t) => t.match(/<([a-zA-Z][a-zA-Z0-9]*)/)?.[1]?.toLowerCase() || '')
    .filter((t) => !voidElements.has(t));
  const closeTags = (htmlStr.match(/<\/([a-zA-Z][a-zA-Z0-9]*)>/g) || [])
    .map((t) => t.match(/<\/([a-zA-Z][a-zA-Z0-9]*)>/)?.[1]?.toLowerCase() || '');

  const tagBalance: Record<string, number> = {};
  for (const tag of openTags) tagBalance[tag] = (tagBalance[tag] || 0) + 1;
  for (const tag of closeTags) tagBalance[tag] = (tagBalance[tag] || 0) - 1;

  for (const [tag, balance] of Object.entries(tagBalance)) {
    if (balance > 0) {
      violations.push({ type: 'unclosed_tag', message: `Tag <${tag}> not closed (${balance} unclosed)`, severity: 'warning' });
    }
  }

  return {
    format: 'html',
    success: violations.filter(isSyntaxViolation).length === 0,
    parsed: htmlStr,
    violations,
  };
}

// ===== YAML 解析器（基础） =====

export function parseYAML(content: string): FormatParseResult {
  const violations: FormatViolation[] = [];

  const payload = extractFormatPayload('yaml', content);
  const yamlStr = payload.text;
  if (payload.trailing) {
    violations.push({
      type: TRAILING_CONTENT_VIOLATION,
      message: 'YAML body is fenced and extra text exists outside the fence',
      severity: 'warning',
    });
  }

  // 基础 YAML 格式检查（不依赖外部库）
  const lines = yamlStr.split('\n');
  let hasKey = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (line.trim() === '---' || line.trim() === '...') continue;

    // 检查缩进一致性
    const indent = line.match(/^(\s*)/)?.[1] || '';
    if (indent.includes('\t')) {
      violations.push({
        type: 'invalid_indent',
        message: `Line ${i + 1}: tabs are not allowed in YAML`,
        severity: 'error',
      });
    }

    // 检查 key: value 格式
    if (/^[a-zA-Z_"'&*][\w\-."'&* ]*\s*:/.test(line.trim())) {
      hasKey = true;
    } else if (!line.trim().startsWith('-') && !line.trim().startsWith(':') && !line.includes(':')) {
      violations.push({
        type: 'invalid_syntax',
        message: `Line ${i + 1}: invalid YAML syntax`,
        severity: 'warning',
      });
    }
  }

  if (!hasKey) {
    violations.push({ type: 'invalid_syntax', message: 'No key-value pairs found', severity: 'error' });
  }

  return {
    format: 'yaml',
    success: violations.filter(isSyntaxViolation).length === 0,
    parsed: yamlStr,
    violations,
  };
}

// ===== 正则解析器 =====

export function parseRegex(
  content: string,
  options?: { positiveSamples?: string[]; negativeSamples?: string[] },
): FormatParseResult {
  const violations: FormatViolation[] = [];

  const payload = extractFormatPayload('regex', content);
  const regexStr = payload.text;

  // 尝试解析正则
  let regex: RegExp;
  try {
    // 尝试 /pattern/flags 格式
    const match = regexStr.match(/^\/(.+)\/([gimsuy]*)$/);
    if (match) {
      regex = new RegExp(match[1], match[2]);
    } else {
      regex = new RegExp(regexStr);
    }
  } catch (err) {
    violations.push({
      type: 'parse_error',
      message: err instanceof Error ? err.message : 'Invalid regex',
      severity: 'error',
    });
    return { format: 'regex', success: false, violations };
  }

  // 正反样本测试
  if (options?.positiveSamples) {
    for (const sample of options.positiveSamples) {
      if (!regex.test(sample)) {
        violations.push({
          type: 'test_failure',
          message: `Positive sample "${sample}" did not match`,
          severity: 'error',
        });
      }
    }
  }
  if (options?.negativeSamples) {
    for (const sample of options.negativeSamples) {
      if (regex.test(sample)) {
        violations.push({
          type: 'test_failure',
          message: `Negative sample "${sample}" should not match`,
          severity: 'error',
        });
      }
    }
  }

  return {
    format: 'regex',
    success: violations.filter(isSyntaxViolation).length === 0,
    parsed: regex,
    violations,
  };
}

// ===== Mermaid 解析器（GPT5.6 P0-8） =====

export function parseMermaid(content: string): FormatParseResult {
  const violations: FormatViolation[] = [];

  const payload = extractFormatPayload('mermaid', content);
  const mdStr = payload.text;
  if (payload.trailing) {
    violations.push({
      type: TRAILING_CONTENT_VIOLATION,
      message: 'Mermaid body is fenced and extra text exists outside the fence',
      severity: 'warning',
    });
  }

  // 检查是否包含有效的 Mermaid 图表类型
  const validTypes = [
    'graph', 'flowchart', 'sequenceDiagram', 'classDiagram',
    'stateDiagram', 'erDiagram', 'gantt', 'pie', 'gitGraph',
    'journey', 'mindmap', 'timeline', 'sankey', 'xychart',
    'block-beta', 'requirementDiagram', 'quadrantChart',
  ];

  const firstLine = mdStr.split('\n')[0]?.trim() || '';
  const hasValidType = validTypes.some((t) => firstLine.startsWith(t) || firstLine.includes(t));

  if (!hasValidType) {
    violations.push({
      type: 'invalid_syntax',
      message: `No valid Mermaid diagram type found. First line: "${firstLine.slice(0, 50)}"`,
      severity: 'error',
    });
  }

  // 括号平衡检查。
  // erDiagram 的关系线使用基数记法（||--o{ / }o--|| / |o--o{），
  // 其中的 { } | o 不是分组符号，必须从平衡检查里排除，否则恒定误报「未闭合括号」。
  const isEntityRelationship = /^\s*erDiagram/i.test(firstLine);
  const balanceSource = isEntityRelationship
    ? mdStr.split('\n').filter((line) => !line.includes('--') && !line.includes('..')).join('\n')
    : mdStr;

  let bracketDepth = 0;
  let unbalanced = false;
  for (const char of balanceSource) {
    if (char === '[' || char === '{' || char === '(') bracketDepth++;
    if (char === ']' || char === '}' || char === ')') bracketDepth--;
    if (bracketDepth < 0) {
      violations.push({ type: 'unmatched_bracket', message: 'Unmatched closing bracket', severity: 'error' });
      unbalanced = true;
      break;
    }
  }
  if (!unbalanced && bracketDepth > 0) {
    violations.push({ type: 'unmatched_bracket', message: `${bracketDepth} unclosed brackets`, severity: 'error' });
  }

  return {
    format: 'mermaid',
    success: violations.filter(isSyntaxViolation).length === 0,
    parsed: mdStr,
    violations,
  };
}

// ===== Markdown 解析器（GPT5.6 P0-8） =====

export function parseMarkdown(content: string): FormatParseResult {
  const violations: FormatViolation[] = [];

  // Markdown 文档本身可以合法包含多个围栏代码块，
  // 因此只有在「整份输出恰好是一个围栏块」时才把它当作围栏剥离，
  // 否则一律按整篇文档解析（旧实现无条件取第一个围栏，
  // 会把 ```http / ```sql 之外的全部内容丢掉，导致字段检查在错误文本上执行）。
  const payload = extractFormatPayload('markdown', content);
  const mdStr = payload.text;

  // 检查基本 Markdown 结构
  const hasHeading = /^#{1,6}\s/m.test(mdStr);
  const hasList = /^[-*+]\s/m.test(mdStr) || /^\d+\.\s/m.test(mdStr);
  const hasParagraph = mdStr.split('\n\n').length > 1;

  if (!hasHeading && !hasList && !hasParagraph) {
    violations.push({
      type: 'missing_structure',
      message: 'Content does not appear to be valid Markdown (no headings, lists, or paragraphs)',
      severity: 'warning',
    });
  }

  // 检查代码块配对
  const fenceCount = (mdStr.match(/^```/gm) || []).length;
  if (fenceCount % 2 !== 0) {
    violations.push({
      type: 'unclosed_code_block',
      message: `Unclosed code block (${fenceCount} fences, expected even number)`,
      severity: 'error',
    });
  }

  return {
    format: 'markdown',
    success: violations.filter(isSyntaxViolation).length === 0,
    parsed: mdStr,
    violations,
  };
}

// ===== TOML 解析器（GPT5.6 P0-8） =====

export function parseTOML(content: string): FormatParseResult {
  const violations: FormatViolation[] = [];

  const payload = extractFormatPayload('toml', content);
  const tomlStr = payload.text;
  if (payload.trailing) {
    violations.push({
      type: TRAILING_CONTENT_VIOLATION,
      message: 'TOML body is fenced and extra text exists outside the fence',
      severity: 'warning',
    });
  }

  const lines = tomlStr.split('\n');
  let hasKey = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('#')) continue;

    // Table header [section]
    if (/^\[[\w.-]+\]$/.test(line)) continue;
    // Array of tables [[section]]
    if (/^\[\[[\w.-]+\]\]$/.test(line)) continue;

    // Key = value
    if (/^[\w.-]+\s*=/.test(line)) {
      hasKey = true;
      const value = line.split('=').slice(1).join('=').trim();
      if (value === '') {
        violations.push({
          type: 'invalid_syntax',
          message: `Line ${i + 1}: empty value`,
          severity: 'warning',
        });
      }
      continue;
    }

    violations.push({
      type: 'invalid_syntax',
      message: `Line ${i + 1}: invalid TOML syntax`,
      severity: 'warning',
    });
  }

  if (!hasKey) {
    violations.push({ type: 'invalid_syntax', message: 'No key-value pairs found', severity: 'error' });
  }

  return {
    format: 'toml',
    success: violations.filter(isSyntaxViolation).length === 0,
    parsed: tomlStr,
    violations,
  };
}

// ===== 统一解析入口（GPT5.6 P0-8 扩展） =====

export type SupportedFormat = 'json' | 'csv' | 'xml' | 'sql' | 'html' | 'yaml' | 'regex' | 'mermaid' | 'markdown' | 'toml';

export function parseByFormat(
  format: SupportedFormat,
  content: string,
  options?: Record<string, unknown>,
): FormatParseResult {
  switch (format) {
    case 'json':
      return parseJSON(content, options?.schema as Record<string, unknown>);
    case 'csv':
      return parseCSV(content, options as { expectedColumns?: string[]; minRows?: number; maxRows?: number });
    case 'xml':
      return parseXML(content);
    case 'sql':
      return parseSQL(content);
    case 'html':
      return parseHTML(content);
    case 'yaml':
      return parseYAML(content);
    case 'regex':
      return parseRegex(content, options as { positiveSamples?: string[]; negativeSamples?: string[] });
    case 'mermaid':
      return parseMermaid(content);
    case 'markdown':
      return parseMarkdown(content);
    case 'toml':
      return parseTOML(content);
    default:
      return {
        format,
        success: false,
        violations: [{ type: 'unsupported', message: `Format "${format}" is not supported`, severity: 'error' }],
      };
  }
}
