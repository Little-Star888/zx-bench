// ============================================================
// Structured Output 评分器 v5
// 只对实际可解析、且满足场景声明字段/约束的内容给分。格式正确不等于内容正确；
// 没有明确可验证的轴一律标记为 unmeasured，绝不以默认 100 填充。
//
// v5 新增（09-16 续修）：
//  * JSON Schema 校验从 MVP（type/required/properties）扩展到
//    oneOf/anyOf/allOf、enum/const、pattern、format(date|time|date-time|uuid|email)、
//    minLength/maxLength、minimum/maximum、minItems/maxItems、items、$ref→$defs，
//    未实现的关键字一律跳过（不臆断）；
//  * schema 轴改为按覆盖率折算计分（违规数 / 实际执行的约束数），
//    避免约束多的题被一刀切扣成 0；证据里回显约束总数以便审计覆盖率。
//  行为变更，故版本号从 v4 提升到 v5，v2/v3/v4 作为兼容版本保留。
//
// v4 修复（09-13 结构化输出维度评审）：
//  1. 字段检查不再依赖 parsed 的 JS 类型。旧实现用 `typeof parsed === 'string'`
//     取文本，而 sql 的 parsed 是语句数组、regex 是 RegExp 对象，
//     导致这些格式的 requiredFields 恒定 0 分（SO-CN-013/015/017 全部误杀）。
//  2. JSON 解析失败不再连带清零 field_constraints：解析器现在会平衡扫描出
//     最外层 JSON 值，尾部解释句只按「输出纪律」扣分。
//  3. 语法轴只统计语法/结构错误；schema_mismatch / missing_required
//     归 schema 轴，不再让内容缺失双重扣语法分。
//  4. requiredFields 支持 `a||b` 备选路径与 `**.key` 任意深度匹配，解决题面未规定
//     字段名/容器名时口径过窄的问题。分隔符用 `||`，保证单个 `|`（markdown 表格）
//     仍可作为字面声明字段；非标识符开头的字段（`---`、`&anchor`、`*alias`）按字面 token 匹配。
//  5. schema / constraints 支持从 requirements 回退读取
//     （ScenarioDefinition 没有 schema / constraints 列，只能经由 requirements 承载）。
//  6. 输出纪律分级：围栏语言白名单 + 尾部冗余文本，不再一律 0/100。
// ============================================================

import type { AxisEvidence, ModelResponse, OutputMetadata, Scenario, ScenarioResult } from '@zxbench/types';
import type { Evaluator } from './index.js';
import {
  extractFormatPayload,
  isSyntaxViolation,
  parseByFormat,
  type SupportedFormat,
} from '../parsers/index.js';

type Requirements = {
  format?: SupportedFormat;
  requiredFields?: string[];
  crossFieldRules?: string[];
  constraints?: string[];
  schema?: Record<string, unknown>;
  output_policy?: 'raw_only' | 'fenced_allowed';
  outputPolicy?: 'raw_only' | 'fenced_allowed';
  allowed_fence_languages?: string[];
  allowedFenceLanguages?: string[];
};

const SUPPORTED_FORMATS = new Set<SupportedFormat>([
  'json', 'csv', 'xml', 'sql', 'html', 'yaml', 'regex', 'mermaid', 'markdown', 'toml',
]);

/** 只有基于解析结果才能判断字段是否存在的格式；其余按原始正文文本匹配。 */
const OBJECT_FORMATS = new Set<SupportedFormat>(['json', 'csv']);

export const structuredOutputEvaluator: Evaluator = {
  name: 'schema_compliance',
  version: 'schema_compliance_v5',
  compatibleVersions: ['schema_compliance_v4', 'schema_compliance_v3', 'schema_compliance_v2'],
  aliases: ['structured_output_v2'],

  async evaluate(
    scenario: Scenario,
    modelOutput: string,
    _metadata: OutputMetadata,
    _modelResponse: ModelResponse,
  ): Promise<Partial<ScenarioResult>> {
    const axisScores: Record<string, number> = {};
    const axisEvidence: Record<string, AxisEvidence> = {};
    const evidence: string[] = [];
    const requirements = readRequirements(scenario);
    const format = detectFormat(scenario, requirements);
    const declaredSchema = readSchema(scenario, requirements);

    const parsed = parseByFormat(format, modelOutput, {
      schema: declaredSchema,
      expectedColumns: format === 'csv' ? requirements.requiredFields : undefined,
    });

    // 正文语料：文本类格式（sql/xml/html/yaml/toml/markdown/mermaid/regex）的字段检查
    // 一律基于原始正文，而不是 parsed 的运行时类型。
    const payload = extractFormatPayload(format, modelOutput);
    const textCorpus = OBJECT_FORMATS.has(format) ? '' : payload.text;
    const syntaxErrors = parsed.violations.filter(isSyntaxViolation);

    // -------- 语法轴：与内容约束无关 --------
    axisScores.syntax_parse = syntaxErrors.length === 0
      ? 100
      : Math.max(0, 100 - syntaxErrors.length * 35);
    axisEvidence.syntax_parse = 'rule';
    evidence.push(syntaxErrors.length === 0
      ? `Format "${format}" parsed successfully`
      : `Format "${format}" structural errors: ${syntaxErrors.length}`);
    for (const violation of syntaxErrors.slice(0, 3)) evidence.push(`  - ${violation.message}`);
    // 警告类违规（尾部散文被截断、围栏包裹等）不进语法轴，但必须可见，否则无法审计「为什么扣了纪律分」
    const warnings = parsed.violations.filter((v) => v.severity === 'warning');
    for (const warning of warnings.slice(0, 3)) evidence.push(`  ! ${warning.message}`);

    // -------- schema 轴 --------
    if (declaredSchema) {
      const schemaViolations = parsed.violations.filter(
        (v) => v.type === 'schema_mismatch' || v.type === 'missing_required',
      );
      const schemaChecks = parsed.schemaChecks ?? 0;
      // 按覆盖率折算计分：约束多的题不应因命中 4 条就被一刀切到 0 分。
      axisScores.schema_compliance = schemaViolations.length === 0
        ? 100
        : schemaChecks > 0
          ? Math.max(0, Math.round((1 - schemaViolations.length / schemaChecks) * 100))
          : Math.max(0, 100 - schemaViolations.length * 25);
      axisEvidence.schema_compliance = 'rule';
      evidence.push(schemaViolations.length === 0
        ? `Schema validation passed (${schemaChecks} constraints)`
        : `Schema violations: ${schemaViolations.length}/${schemaChecks} constraints`);
      for (const violation of schemaViolations.slice(0, 5)) evidence.push(`  - ${violation.message}`);
    } else {
      axisEvidence.schema_compliance = 'unmeasured';
    }

    // -------- 声明字段 / 约束轴 --------
    const declaredFields = requirements.requiredFields ?? [];
    const declaredConstraints = readConstraints(scenario, requirements);
    const checks = [
      ...declaredFields.map((field) => ({
        label: `required field ${field}`,
        pass: checkDeclaredField(format, parsed.parsed, textCorpus, field),
      })),
      ...declaredConstraints.map((constraint) => ({
        label: `constraint ${constraint}`,
        pass: evaluateConstraint(constraint, parsed.parsed),
      })),
    ];
    if (checks.length > 0) {
      const passCount = checks.filter((check) => check.pass).length;
      axisScores.field_constraints = Math.round((passCount / checks.length) * 100);
      axisEvidence.field_constraints = 'rule';
      const failures = checks.filter((check) => !check.pass).map((check) => check.label);
      evidence.push(`Declared fields/constraints: ${passCount}/${checks.length} passed`);
      if (failures.length > 0) evidence.push(`Missing or invalid: ${failures.slice(0, 5).join(', ')}`);
    } else {
      axisEvidence.field_constraints = 'unmeasured';
    }

    // -------- 跨字段一致性轴 --------
    const crossRules = requirements.crossFieldRules ?? [];
    if (crossRules.length > 0) {
      const passCount = crossRules.filter((rule) => evaluateCrossFieldRule(rule, parsed.parsed)).length;
      axisScores.cross_field_consistency = Math.round((passCount / crossRules.length) * 100);
      axisEvidence.cross_field_consistency = 'rule';
      evidence.push(`Cross-field rules: ${passCount}/${crossRules.length} passed`);
      for (const rule of crossRules) {
        if (!evaluateCrossFieldRule(rule, parsed.parsed)) evidence.push(`  - failed rule: ${rule}`);
      }
    } else {
      axisEvidence.cross_field_consistency = 'unmeasured';
    }

    // Parsing is not execution/rendering. Keep this axis absent until a sandbox or renderer is configured.
    axisEvidence.executable = 'unmeasured';

    // -------- 输出纪律轴 --------
    // 注意：payload.fenced 表示「正文取自围栏内部」，本身不是违规；
    // 真正违规的是**围栏之外还有内容**（payload.trailing）或解析器报出的尾部冗余。
    const wrappedOrTrailing = payload.trailing
      || parsed.violations.some((v) => v.type === 'trailing_content');
    axisScores.output_discipline = checkOutputDiscipline(
      modelOutput,
      requirements.outputPolicy ?? requirements.output_policy ?? 'raw_only',
      requirements.allowedFenceLanguages ?? requirements.allowed_fence_languages ?? [],
      wrappedOrTrailing,
    );
    axisEvidence.output_discipline = 'rule';
    if (axisScores.output_discipline < 100) {
      evidence.push(wrappedOrTrailing
        ? 'Output wraps the format body in a fence or appends non-format text'
        : 'Output contains a fence or non-format text forbidden by raw_only policy');
    }

    const totalScore = weightedMeasuredScore(axisScores, axisEvidence, {
      syntax_parse: 0.30,
      schema_compliance: 0.20,
      field_constraints: 0.40,
      cross_field_consistency: 0.05,
      output_discipline: 0.05,
    });

    return { axisScores, axisEvidence, totalScore, safetyLevel: 'safe', evidence };
  },
};

function readRequirements(scenario: Scenario): Requirements {
  const raw = scenario.requirements as unknown;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Requirements : {};
}

/**
 * scenario.schema 优先；ScenarioDefinition 无 schema 列，因此 requirements.schema 作为
 * 正式承载位置（题集把 JSON Schema 写在 requirements 里）。
 */
function readSchema(scenario: Scenario, requirements: Requirements): Record<string, unknown> | undefined {
  if (scenario.schema && typeof scenario.schema === 'object') return scenario.schema;
  if (requirements.schema && typeof requirements.schema === 'object') return requirements.schema;
  return undefined;
}

function readConstraints(scenario: Scenario, requirements: Requirements): string[] {
  if (Array.isArray(scenario.constraints)) return scenario.constraints;
  if (Array.isArray(requirements.constraints)) return requirements.constraints as string[];
  return [];
}

function detectFormat(scenario: Scenario, requirements: Requirements): SupportedFormat {
  if (requirements.format && SUPPORTED_FORMATS.has(requirements.format)) return requirements.format;
  const schemaFormat = scenario.schema && (scenario.schema as Record<string, unknown>).format;
  if (typeof schemaFormat === 'string' && SUPPORTED_FORMATS.has(schemaFormat as SupportedFormat)) {
    return schemaFormat as SupportedFormat;
  }
  const grader = scenario.grader.toLowerCase();
  for (const format of SUPPORTED_FORMATS) if (grader.includes(format)) return format;
  return 'json';
}

/**
 * `a||b||c` 表示备选路径：只要任一命中即视为满足。
 * 分隔符用 `||` 而不是 `|`，因为 markdown 题会把单个 `|`（表格竖线）本身作为声明字段。
 */
function fieldAlternatives(field: string): string[] {
  return field.split('||').map((part) => part.trim()).filter(Boolean);
}

function checkDeclaredField(
  format: SupportedFormat,
  parsedValue: unknown,
  textCorpus: string,
  field: string,
): boolean {
  const alternatives = fieldAlternatives(field);
  if (alternatives.length === 0) return false;
  return alternatives.some((alt) => checkSingleField(format, parsedValue, textCorpus, alt));
}

function checkSingleField(
  format: SupportedFormat,
  parsedValue: unknown,
  textCorpus: string,
  field: string,
): boolean {
  if (format === 'json') return getPath(parsedValue, field) !== undefined;
  if (format === 'csv') {
    return Boolean(
      parsedValue && typeof parsedValue === 'object'
        && Array.isArray((parsedValue as { headers?: unknown }).headers)
        && ((parsedValue as { headers: string[] }).headers).includes(field),
    );
  }

  const text = textCorpus;
  if (!text) return false;
  // `re:<正则>`：结构化断言（如 markdown 的「一级标题」「表格行」「有序列表项」）。
  // 单字符字面量（#、|、1.）只能证明「该字符出现过」，区分度极弱且容易被正文偶然命中。
  if (field.startsWith('re:')) {
    try {
      return new RegExp(field.slice(3), 'm').test(text);
    } catch {
      return false;
    }
  }
  const escaped = escapeRegExp(field);
  switch (format) {
    case 'yaml':
      // `---` / `&anchor` / `*alias` 这类结构性 token 无法用 `key:` 形式表达
      if (isLiteralToken(field)) return text.includes(field);
      return new RegExp(`^\\s*${escaped}\\s*:`, 'mi').test(text);
    case 'toml':
      if (isLiteralToken(field)) return text.includes(field);
      // 支持 [section] 与数组表 [[section]]（字段名写裸段名，如 bin 匹配 [[bin]]）
      return new RegExp(`(?:^\\s*\\[\\[?${escaped}\\]\\]?\\s*$|^\\s*${escaped}\\s*=)`, 'mi').test(text);
    case 'xml':
      // `xml` 字段对 XML 题指的是 XML 声明 `<?xml ... ?>`，不是同名标签
      if (field.toLowerCase() === 'xml') return /<\?xml/i.test(text);
      return new RegExp(`<(?:[\\w.-]+:)?${escaped}(?:\\s|>|/)`, 'i').test(text)
        || new RegExp(`\\s(?:[\\w.-]+:)?${escaped}\\s*=`, 'i').test(text);
    case 'html':
      if (field.toUpperCase() === 'DOCTYPE') return /^<!doctype\s+html/i.test(text);
      // 标签形式 <style> 或 内联属性形式 style="..."（题面要求「内联 CSS」时后者才算达标）
      return new RegExp(`<${escaped}(?:\\s|>)`, 'i').test(text)
        || new RegExp(`\\b${escaped}\\s*=\\s*["']`, 'i').test(text);
    case 'sql':
      return new RegExp(`\\b${escaped.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text);
    case 'mermaid':
    case 'markdown':
    case 'regex':
      return text.includes(field);
    default:
      return false;
  }
}

/** 以非标识符字符开头的声明字段视为字面 token（`---`、`&anchor`、`*alias`、`#`、`|` …）。 */
function isLiteralToken(field: string): boolean {
  return /^[^\w\u4e00-\u9fff]/.test(field);
}

function getPath(value: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  return resolvePath(value, parts, 0);
}

/**
 * 解析 JSON 路径。
 * `**` 表示「任意深度」：用于题面只规定字段名、未规定外层容器名的场景
 * （例如金额字段既可能平铺在顶层，也可能收在 amounts / amount / totals 之下）。
 */
function resolvePath(current: unknown, parts: string[], depth: number): unknown {
  if (parts.length === 0) return current;
  if (depth > 24) return undefined;

  const [head, ...rest] = parts;
  if (head === '**') {
    const queue: unknown[] = [current];
    const seen = new Set<unknown>();
    while (queue.length > 0) {
      const node = queue.shift();
      if (node === null || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      const hit = resolvePath(node, rest, depth + 1);
      if (hit !== undefined) return hit;
      if (Array.isArray(node)) queue.push(...node);
      else queue.push(...Object.values(node as Record<string, unknown>));
    }
    return undefined;
  }

  if (Array.isArray(current)) return resolvePath(current[Number(head)], rest, depth + 1);
  if (current && typeof current === 'object') {
    return resolvePath((current as Record<string, unknown>)[head], rest, depth + 1);
  }
  return undefined;
}

/** 与 getPath 相同，但支持 `a||b` 备选路径。 */
function getPathAny(data: unknown, spec: string): unknown {
  for (const alt of fieldAlternatives(spec)) {
    const value = getPath(data, alt);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** 简单规则语言：required:<path> | type:<path>=<type> | nonempty:<path> */
function evaluateConstraint(constraint: string, data: unknown): boolean {
  if (constraint.startsWith('required:')) return getPathAny(data, constraint.slice(9).trim()) !== undefined;
  const type = constraint.match(/^type:([^=]+)=(\w+)$/);
  if (type) return typeof getPathAny(data, type[1].trim()) === type[2];
  if (constraint.startsWith('nonempty:')) {
    const value = getPathAny(data, constraint.slice(9));
    return value !== undefined && value !== null && value !== '';
  }
  return false;
}

/**
 * 跨字段规则语言：
 *   equal:a,b | different:a,b | nonempty:a
 *   equals-sum:<target>=<term>+<term>-<term>   （数值恒等式，容差 0.011 覆盖分位舍入）
 * 每个路径位置都接受 `a||b` 备选写法。
 */
function evaluateCrossFieldRule(rule: string, data: unknown): boolean {
  const separator = rule.indexOf(':');
  if (separator < 0) return false;
  const kind = rule.slice(0, separator).trim();
  const payload = rule.slice(separator + 1);
  if (!payload) return false;

  if (kind === 'nonempty') {
    const value = getPathAny(data, payload.trim());
    return value !== undefined && value !== null && value !== '';
  }

  if (kind === 'equals-sum') {
    const eq = payload.indexOf('=');
    if (eq < 0) return false;
    const target = getPathAny(data, payload.slice(0, eq).trim());
    if (typeof target !== 'number' || !Number.isFinite(target)) return false;
    const computed = evaluateNumericExpression(payload.slice(eq + 1), data);
    if (computed === null) return false;
    return Math.abs(target - computed) <= 0.011;
  }

  const parts = payload.split(',');
  if (parts.length !== 2) return false;
  const left = getPathAny(data, parts[0].trim());
  const right = getPathAny(data, parts[1].trim());
  if (left === undefined || right === undefined) return false;
  if (kind === 'equal') return left === right;
  if (kind === 'different') return left !== right;
  return false;
}

/** 计算 `<term>+<term>-<term>` 形式的数值表达式；任一项不是数字则返回 null。 */
function evaluateNumericExpression(expression: string, data: unknown): number | null {
  const terms = expression.split(/(?=[+-])/).map((term) => term.trim()).filter(Boolean);
  if (terms.length === 0) return null;
  let total = 0;
  for (const term of terms) {
    const sign = term.startsWith('-') ? -1 : 1;
    const path = term.replace(/^[+-]/, '').trim();
    const value = getPathAny(data, path);
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    total += sign * value;
  }
  return total;
}

function checkOutputDiscipline(
  output: string,
  policy: 'raw_only' | 'fenced_allowed',
  allowedFenceLanguages: string[],
  wrappedOrTrailing: boolean,
): number {
  const trimmed = output.trim();
  if (!trimmed) return 0;

  // 围栏按「开/关」成对切换统计：只有开围栏的语言有意义，
  // 结束围栏不带语言，若也计入会污染白名单判定。
  const fenceLanguages: string[] = [];
  let insideFence = false;
  for (const line of trimmed.split(/\r?\n/)) {
    const match = line.match(/^```([\w-]*)/);
    if (!match) continue;
    if (!insideFence) {
      fenceLanguages.push((match[1] || '').toLowerCase());
      insideFence = true;
    } else {
      insideFence = false;
    }
  }
  const hasFence = fenceLanguages.length > 0;

  if (policy === 'fenced_allowed') {
    if (!hasFence) return wrappedOrTrailing ? 50 : 100;
    const allowed = allowedFenceLanguages.map((lang) => lang.toLowerCase());
    const allAllowed = allowed.length === 0 || fenceLanguages.every((lang) => allowed.includes(lang));
    if (!allAllowed) return 20;
    return wrappedOrTrailing ? 70 : 100;
  }

  if (hasFence) return 0;
  return wrappedOrTrailing ? 0 : 100;
}

function weightedMeasuredScore(
  scores: Record<string, number>,
  evidence: Record<string, AxisEvidence>,
  weights: Record<string, number>,
): number {
  let numerator = 0;
  let denominator = 0;
  for (const [axis, weight] of Object.entries(weights)) {
    if (evidence[axis] === 'unmeasured' || scores[axis] === undefined) continue;
    numerator += scores[axis] * weight;
    denominator += weight;
  }
  return denominator === 0 ? 0 : Math.round(numerator / denominator);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
