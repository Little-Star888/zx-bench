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
 * 定位文本中第一个语法平衡、可被 JSON.parse 接受的 JSON 值。
 * 用于容忍模型在 JSON 前后附加自然语言解释。
 */
export function extractFirstJsonValue(content: string): { value: string; start: number; end: number } | null {
  for (let i = 0; i < content.length; i++) {
    const first = content[i];
    if (first !== '{' && first !== '[') continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let j = i; j < content.length; j++) {
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
        if (depth === 0) {
          const slice = content.slice(i, j + 1);
          try {
            JSON.parse(slice);
            return { value: slice, start: i, end: j + 1 };
          } catch {
            break; // 这个起点不成立，换下一个 { / [ 起点
          }
        }
      }
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
    if (schema) violations.push(...validateJsonSchema(strict.value, schema));
    return {
      format: 'json',
      success: !violations.some(isSyntaxViolation),
      parsed: strict.value,
      violations,
    };
  }

  // 兜底 1：整份输出被 markdown 围栏包裹
  const fenced = content.trim().match(WHOLE_FENCE_RE);
  if (fenced) {
    const inner = tryParseJson(fenced[2].trim());
    if (inner.ok) {
      violations.push({
        type: TRAILING_CONTENT_VIOLATION,
        message: 'JSON value is wrapped in a markdown fence',
        severity: 'warning',
      });
      if (schema) violations.push(...validateJsonSchema(inner.value, schema));
      return { format: 'json', success: true, parsed: inner.value, violations };
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
      if (schema) violations.push(...validateJsonSchema(extracted.value, schema));
      return { format: 'json', success: true, parsed: extracted.value, violations };
    }
  }

  violations.push({ type: 'parse_error', message: strict.error, severity: 'error' });
  return { format: 'json', success: false, violations };
}

/** 基础 JSON Schema 校验（MVP 实现） */
function validateJsonSchema(data: unknown, schema: Record<string, unknown>): FormatViolation[] {
  const violations: FormatViolation[] = [];
  const schemaType = schema.type as string | undefined;

  if (schemaType) {
    const actualType = Array.isArray(data) ? 'array' : typeof data;
    if (actualType !== schemaType) {
      violations.push({
        type: 'schema_mismatch',
        message: `Expected type "${schemaType}" but got "${actualType}"`,
        severity: 'error',
      });
    }
  }

  if (schemaType === 'object' && typeof data === 'object' && data !== null) {
    const required = schema.required as string[] | undefined;
    const properties = schema.properties as Record<string, unknown> | undefined;

    if (required) {
      for (const key of required) {
        if (!(key in data)) {
          violations.push({
            type: 'missing_required',
            message: `Missing required field: "${key}"`,
            severity: 'error',
          });
        }
      }
    }

    if (properties) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in data) {
          const propViolations = validateJsonSchema(
            (data as Record<string, unknown>)[key],
            propSchema as Record<string, unknown>,
          );
          violations.push(...propViolations.map((v) => ({
            ...v,
            message: `[${key}] ${v.message}`,
          })));
        }
      }
    }
  }

  return violations;
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
  if (payload.fenced) {
    violations.push({
      type: TRAILING_CONTENT_VIOLATION,
      message: 'CSV is wrapped in a markdown fence',
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
  if (payload.fenced) {
    violations.push({
      type: TRAILING_CONTENT_VIOLATION,
      message: 'XML is wrapped in a markdown fence',
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
  if (payload.fenced) {
    violations.push({
      type: TRAILING_CONTENT_VIOLATION,
      message: 'SQL is wrapped in a markdown fence',
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
  if (payload.fenced) {
    violations.push({
      type: TRAILING_CONTENT_VIOLATION,
      message: 'HTML is wrapped in a markdown fence',
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
  if (payload.fenced) {
    violations.push({
      type: TRAILING_CONTENT_VIOLATION,
      message: 'YAML is wrapped in a markdown fence',
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
  if (payload.fenced) {
    violations.push({
      type: TRAILING_CONTENT_VIOLATION,
      message: 'Mermaid diagram is wrapped in a markdown fence',
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
  if (payload.fenced) {
    violations.push({
      type: TRAILING_CONTENT_VIOLATION,
      message: 'TOML is wrapped in a markdown fence',
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
