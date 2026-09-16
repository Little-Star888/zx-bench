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
  countSchemaViolations,
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
  /** 按题覆盖各轴权重（见 readAxisWeights）。缺省时使用 DEFAULT_AXIS_WEIGHTS。 */
  axis_weights?: Record<string, number>;
  axisWeights?: Record<string, number>;
};

/**
 * 默认轴权重。语法轴与输出纪律轴对现代模型近乎白送，
 * 因此「严格结构」类题目会通过 requirements.axis_weights 把权重压到结构正确性上，
 * 否则 8/10 项通过也能拿 90+，维度失去区分度（天花板效应）。
 */
const DEFAULT_AXIS_WEIGHTS: Record<string, number> = {
  syntax_parse: 0.30,
  schema_compliance: 0.20,
  field_constraints: 0.40,
  cross_field_consistency: 0.05,
  output_discipline: 0.05,
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
    const weights = readAxisWeights(requirements) ?? DEFAULT_AXIS_WEIGHTS;

    const parsed = parseByFormat(format, modelOutput, {
      schema: declaredSchema,
      expectedColumns: format === 'csv' ? requirements.requiredFields : undefined,
    });

    // 正文语料：文本类格式（sql/xml/html/yaml/toml/markdown/mermaid/regex）的字段检查
    // 一律基于原始正文，而不是 parsed 的运行时类型。
    // 注意：语料对所有格式都保留 —— `count:` / `order:` 这类规则在 JSON/CSV 题上
    // 同样需要扫描原始文本（否则语料为空，规则恒定失败）。
    const payload = extractFormatPayload(format, modelOutput);
    const textCorpus = payload.text;
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
        pass: evaluateConstraint(constraint, parsed.parsed, textCorpus),
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

    const totalScore = weightedMeasuredScore(axisScores, axisEvidence, weights);

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

/**
 * 按题覆盖轴权重。
 * 用于「严格结构」类题目：把权重从近乎白送的语法/纪律轴，转移到真正区分能力的
 * 结构不变量轴上。未声明（或声明非法）时返回 undefined，走默认权重，老题零扰动。
 */
function readAxisWeights(requirements: Requirements): Record<string, number> | undefined {
  const raw = requirements.axis_weights ?? requirements.axisWeights;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const weights: Record<string, number> = {};
  for (const [axis, weight] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof weight === 'number' && Number.isFinite(weight) && weight >= 0) weights[axis] = weight;
  }
  return Object.keys(weights).length > 0 ? weights : undefined;
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
  // 空索引 `[]` 表示「数组本身」，不是某个下标 → 直接去掉，交给数组分支处理
  const parts = path.replace(/\[\]/g, '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
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

/**
 * 严格结构断言规则语言（2026-09-16 新增，用于恢复该维度的区分度）。
 *
 * 背景：只检查「字段是否存在」是天花板效应的主因 —— 现代模型几乎都能把字形凑齐，
 * 于是分数全部堆在 90+。以下规则全部落在**格式/结构域**（不涉及外部事实抽取，
 * 避免与 data_extraction 维度重叠），且每条都可确定性判定，模型会真实地失败：
 *
 *   required:<path>                              路径存在（支持 a||b / **）
 *   type:<path>=<jsonType>                       值的 JSON 类型（object/array/string/number/integer/boolean/null）
 *   valueEq:<path>=<literal>                     值等于字面量（字符串/数字/true/false/null）
 *   nonempty:<path>                              非空
 *   count:<regex>:<op><n>                        正文正则命中次数（op ∈ >= <= ==）
 *   keys:<path>=a,b,c                            对象键集**精确相等**（无多余、无缺失）
 *   keyOrder:<path>=a,b,c                        对象键**顺序精确一致**
 *   reAll:<path>.<field>:<regex>                 数组每个元素的字段匹配正则
 *   maxDecimals:<path>.<field>=<n>               数组每个元素字段小数位不超过 n（抓未舍入）
 *   unique:<path>.<field>                        数组字段值互不相同
 *   sorted:<path>=<f>:asc,<g>:desc               数组按多键排序
 *   ref:<path>.<field> in <path2>.<field>        引用完整性（外键必须存在于主表）
 *   sumEq:<path>.<field>=<targetPath>:<tol>      数组字段求和等于目标（默认容差 0.011）
 *   productEq:<path>.<field>=<a>*<b>:<decimals>  每个元素满足乘积恒等式
 *   runningTotal:<path>.<field>=<delta>:<init>   累计恒等式 f[i] = f[i-1] + delta[i]
 *   schemaValidates:<schemaPath>:<instancePath>  文档内的 schema 必须接受同文档的实例（自洽）
 *   schemaRejects:<schemaPath>:<instancePath>    反向自洽：实例必须被该 schema 拒绝
 *   keysAll:<path>=a,b,c                         数组中**每个元素**的键集精确相等
 *   length:<path>=<n>                            数组/对象元素个数精确等于 n
 *   ratioEq:<path>.<field>=<srcField>*<factor>:<decimals>  比例恒等式（如 tax = amount×0.06）
 *   chainEq:<path>.<a>=<b>:<initial>             a[i] 必须等于 b[i-1]，且 a[0]=<initial>
 *   csvCell:<rowIndex>:<colIndex>:<regex>        解析后的 CSV 单元格内容（RFC4180 往返）
 *   order:<tokenA>|<tokenB>                      A 必须出现在 B 之前（文本类格式的顺序）
 */
function evaluateConstraint(constraint: string, data: unknown, corpus: string): boolean {
  if (constraint.startsWith('required:')) return getPathAny(data, constraint.slice(9).trim()) !== undefined;

  // JSON 类型语义（object/array/string/number/integer/boolean/null），
  // 而不是 JS 的 typeof —— 否则 `type:schema.type=object` 对字符串 "object" 永远不成立。
  const type = constraint.match(/^type:([^=]+)=(\w+)$/);
  if (type) return matchesJsonType(getPathAny(data, type[1].trim()), type[2]);

  if (constraint.startsWith('nonempty:')) {
    const value = getPathAny(data, constraint.slice(9));
    return value !== undefined && value !== null && value !== '';
  }

  const count = constraint.match(/^count:(.+):(>=|<=|==)(\d+)$/);
  if (count) {
    let hits = 0;
    try {
      hits = (corpus.match(new RegExp(count[1], 'gm')) ?? []).length;
    } catch {
      return false;
    }
    const target = Number(count[3]);
    return count[2] === '>=' ? hits >= target : count[2] === '<=' ? hits <= target : hits === target;
  }

  const keys = constraint.match(/^keys:([^=]+)=(.+)$/);
  if (keys) {
    const node = getPathAny(data, keys[1].trim());
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
    const actual = Object.keys(node as Record<string, unknown>).sort();
    const expected = keys[2].split(',').map((k) => k.trim()).filter(Boolean).sort();
    return actual.length === expected.length && actual.every((k, i) => k === expected[i]);
  }

  const keyOrder = constraint.match(/^keyOrder:([^=]+)=(.+)$/);
  if (keyOrder) {
    const node = getPathAny(data, keyOrder[1].trim());
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
    const actual = Object.keys(node as Record<string, unknown>);
    const expected = keyOrder[2].split(',').map((k) => k.trim()).filter(Boolean);
    return actual.length === expected.length && actual.every((k, i) => k === expected[i]);
  }

  const reAll = constraint.match(/^reAll:([^:]+):(.+)$/);
  if (reAll) {
    const [arrayPath, field] = splitFieldPath(reAll[1]);
    const rows = asArray(getPathAny(data, arrayPath));
    if (rows === null || rows.length === 0) return false;
    let pattern: RegExp;
    try {
      pattern = new RegExp(reAll[2]);
    } catch {
      return false;
    }
    return rows.every((row) => {
      const value = field ? (row as Record<string, unknown>)?.[field] : row;
      return typeof value === 'string' && pattern.test(value);
    });
  }

  // JSON 数字不保留尾随零（21.00 解析后就是 21），因此只能断言「小数位不超过 n」，
  // 用来抓未舍入的结果（如 21.004999999999995 / 21.005）。命名如实反映语义。
  const maxDecimals = constraint.match(/^maxDecimals:([^=]+)=(\d+)$/);
  if (maxDecimals) {
    const [arrayPath, field] = splitFieldPath(maxDecimals[1]);
    const rows = asArray(getPathAny(data, arrayPath));
    if (rows === null || rows.length === 0) return false;
    const limit = Number(maxDecimals[2]);
    return rows.every((row) => {
      const value = field ? (row as Record<string, unknown>)?.[field] : row;
      const places = typeof value === 'number' ? countDecimals(value) : -1;
      return places >= 0 && places <= limit;
    });
  }

  const unique = constraint.match(/^unique:(.+)$/);
  if (unique) {
    const [arrayPath, field] = splitFieldPath(unique[1]);
    const rows = asArray(getPathAny(data, arrayPath));
    if (rows === null || rows.length === 0) return false;
    const seen = new Set<string>();
    for (const row of rows) {
      const value = field ? (row as Record<string, unknown>)?.[field] : row;
      const key = JSON.stringify(value);
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  }

  const sorted = constraint.match(/^sorted:([^=]+)=(.+)$/);
  if (sorted) {
    const rows = asArray(getPathAny(data, sorted[1].trim()));
    if (rows === null || rows.length < 2) return false;
    const criteria = sorted[2].split(',').map((part) => {
      const [field, dir] = part.trim().split(':');
      return { field: field.trim(), desc: (dir ?? 'asc').trim().toLowerCase() === 'desc' };
    });
    for (let i = 1; i < rows.length; i++) {
      for (const { field, desc } of criteria) {
        const left = (rows[i - 1] as Record<string, unknown>)?.[field];
        const right = (rows[i] as Record<string, unknown>)?.[field];
        const cmp = compareValues(left, right);
        if (cmp === 0) continue;
        if (desc ? cmp < 0 : cmp > 0) return false;
        break;
      }
    }
    return true;
  }

  const ref = constraint.match(/^ref:([^:]+)\s+in\s+(.+)$/);
  if (ref) {
    const [childPath, childField] = splitFieldPath(ref[1]);
    const [parentPath, parentField] = splitFieldPath(ref[2]);
    const children = asArray(getPathAny(data, childPath));
    const parents = asArray(getPathAny(data, parentPath));
    if (children === null || parents === null) return false;
    const allowed = new Set(parents.map((p) => JSON.stringify((p as Record<string, unknown>)?.[parentField])));
    return children.every((c) => allowed.has(JSON.stringify((c as Record<string, unknown>)?.[childField])));
  }

  const sumEq = constraint.match(/^sumEq:([^=]+)=(.+?)(?::([\d.]+))?$/);
  if (sumEq) {
    const [arrayPath, field] = splitFieldPath(sumEq[1]);
    const rows = asArray(getPathAny(data, arrayPath));
    const target = getPathAny(data, sumEq[2].trim());
    if (rows === null || rows.length === 0 || typeof target !== 'number') return false;
    const total = rows.reduce<number>((acc, row) => {
      const value = (row as Record<string, unknown>)?.[field];
      return typeof value === 'number' ? acc + value : NaN;
    }, 0);
    if (!Number.isFinite(total)) return false;
    const tol = sumEq[3] ? Number(sumEq[3]) : 0.011;
    return Math.abs(total - target) <= tol;
  }

  const productEq = constraint.match(/^productEq:([^=]+)=([^=*]+)\*([^:]+)(?::(\d+))?$/);
  if (productEq) {
    const [arrayPath, field] = splitFieldPath(productEq[1]);
    const rows = asArray(getPathAny(data, arrayPath));
    if (rows === null || rows.length === 0) return false;
    const left = productEq[2].trim();
    const right = productEq[3].trim();
    const wanted = productEq[4] ? Number(productEq[4]) : null;
    const tol = wanted === null ? 0.011 : 0.5 * Math.pow(10, -wanted) + 1e-6;
    return rows.every((row) => {
      const node = row as Record<string, unknown>;
      const target = node?.[field];
      const a = node?.[left];
      const b = node?.[right];
      if (typeof target !== 'number' || typeof a !== 'number' || typeof b !== 'number') return false;
      // 「小数位不超过 n」：JSON 不保留尾随零，只能抓未舍入的精度溢出
      if (wanted !== null && countDecimals(target) > wanted) return false;
      return Math.abs(target - a * b) <= tol;
    });
  }

  const running = constraint.match(/^runningTotal:([^=]+)=([^:]+)(?::([\d.-]+))?$/);
  if (running) {
    const [arrayPath, field] = splitFieldPath(running[1]);
    const rows = asArray(getPathAny(data, arrayPath));
    if (rows === null || rows.length === 0) return false;
    const deltaField = running[2].trim();
    let running0 = running[3] === undefined ? null : Number(running[3]);
    let previous = running0;
    for (const row of rows) {
      const node = row as Record<string, unknown>;
      const value = node?.[field];
      const delta = node?.[deltaField];
      if (typeof value !== 'number' || typeof delta !== 'number') return false;
      if (previous !== null && Math.abs(value - (previous + delta)) > 0.011) return false;
      previous = value;
    }
    return true;
  }

  const selfValidate = constraint.match(/^schemaValidates:([^:]+):(.+)$/);
  if (selfValidate) {
    const schema = getPathAny(data, selfValidate[1].trim());
    const instance = getPathAny(data, selfValidate[2].trim());
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false;
    if (instance === undefined) return false;
    return countSchemaViolations(instance, schema as Record<string, unknown>) === 0;
  }

  // 反向自洽：声明「这个实例必须被该 schema 拒绝」——用于检验模型是否真懂自己的约束
  const selfReject = constraint.match(/^schemaRejects:([^:]+):(.+)$/);
  if (selfReject) {
    const schema = getPathAny(data, selfReject[1].trim());
    const instance = getPathAny(data, selfReject[2].trim());
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false;
    if (instance === undefined) return false;
    return countSchemaViolations(instance, schema as Record<string, unknown>) > 0;
  }

  const keysAll = constraint.match(/^keysAll:([^=]+)=(.+)$/);
  if (keysAll) {
    const rows = asArray(getPathAny(data, keysAll[1].trim()));
    if (rows === null || rows.length === 0) return false;
    const expected = keysAll[2].split(',').map((k) => k.trim()).filter(Boolean).sort();
    return rows.every((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
      const actual = Object.keys(row as Record<string, unknown>).sort();
      return actual.length === expected.length && actual.every((k, i) => k === expected[i]);
    });
  }

  const length = constraint.match(/^length:([^=]+)=(\d+)$/);
  if (length) {
    const container = asArray(getPathAny(data, length[1].trim()));
    return container !== null && container.length === Number(length[2]);
  }

  const ratioEq = constraint.match(/^ratioEq:([^=]+)=([^=*]+)\*([^:]+)(?::(\d+))?$/);
  if (ratioEq) {
    const [arrayPath, field] = splitFieldPath(ratioEq[1]);
    const rows = asArray(getPathAny(data, arrayPath));
    if (rows === null || rows.length === 0) return false;
    const sourceField = ratioEq[2].trim();
    const factor = Number(ratioEq[3].trim());
    if (!Number.isFinite(factor)) return false;
    const limit = ratioEq[4] ? Number(ratioEq[4]) : null;
    // 二进制的半单位边界（如 1.305 恰好落在 0.5×10⁻² 上）会因浮点表示被判超差，
    // 加 1e-6 的表示误差余量，避免对「正确舍入」的输出产生假阴性。
    const tol = limit === null ? 0.011 : 0.5 * Math.pow(10, -limit) + 1e-6;
    return rows.every((row) => {
      const node = row as Record<string, unknown>;
      const target = node?.[field];
      const source = node?.[sourceField];
      if (typeof target !== 'number' || typeof source !== 'number') return false;
      if (limit !== null && countDecimals(target) > limit) return false;
      return Math.abs(target - source * factor) <= tol;
    });
  }

  // 链式恒等式：a[i] === b[i-1]，且 a[0] === initial —— 长列表一致性最有效的判别器
  const chain = constraint.match(/^chainEq:([^=]+)\.([^=]+)=([^:]+)(?::([\d.-]+))?$/);
  if (chain) {
    const rows = asArray(getPathAny(data, chain[1].trim()));
    if (rows === null || rows.length === 0) return false;
    const leftField = chain[2].trim();
    const rightField = chain[3].trim();
    const initial = chain[4] === undefined ? null : Number(chain[4]);
    let previousRight: number | null = initial;
    for (const row of rows) {
      const node = row as Record<string, unknown>;
      const left = node?.[leftField];
      const right = node?.[rightField];
      if (typeof left !== 'number' || typeof right !== 'number') return false;
      if (previousRight !== null && Math.abs(left - previousRight) > 0.011) return false;
      previousRight = right;
    }
    return true;
  }

  const valueEq = constraint.match(/^valueEq:([^=]+)=(.+)$/);
  if (valueEq) {
    const actual = getPathAny(data, valueEq[1].trim());
    if (actual === undefined) return false;
    const raw = valueEq[2].trim();
    const expected: unknown = raw === 'true' ? true
      : raw === 'false' ? false
        : raw === 'null' ? null
          : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw)
            : raw;
    return actual === expected;
  }

  // CSV 单元格断言：直接检视解析后的表格，验证 RFC4180 往返是否成立
  const csvCell = constraint.match(/^csvCell:(\d+):(\d+):(.+)$/);
  if (csvCell) {
    const parsed = data as { rows?: unknown } | null;
    const rows = parsed && Array.isArray(parsed.rows) ? (parsed.rows as unknown[][]) : null;
    if (!rows) return false;
    const row = rows[Number(csvCell[1])];
    if (!Array.isArray(row)) return false;
    const cell = row[Number(csvCell[2])];
    if (typeof cell !== 'string') return false;
    try {
      return new RegExp(csvCell[3], 's').test(cell);
    } catch {
      return false;
    }
  }

  // 文本类格式的相对顺序：A 必须出现在 B 之前（如 <items> 必须在 </items> 之前）
  const order = constraint.match(/^order:(.+)\|(.+)$/);
  if (order) {
    const first = corpus.indexOf(order[1]);
    const second = corpus.indexOf(order[2]);
    return first >= 0 && second >= 0 && first < second;
  }

  return false;
}

/** 拆 `a.b[].c` → ["a.b", "c"]；无字段部分时返回数组路径本身。 */
function splitFieldPath(spec: string): [string, string] {
  const trimmed = spec.trim().replace(/\[\]/g, '');
  const cut = trimmed.lastIndexOf('.');
  if (cut <= 0) return [trimmed, ''];
  return [trimmed.slice(0, cut), trimmed.slice(cut + 1)];
}

function asArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return null;
}

/** JSON 类型判定（区别于 JS 的 typeof）。 */
function matchesJsonType(value: unknown, expected: string): boolean {
  if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expected === 'boolean') return typeof value === 'boolean';
  if (expected === 'null') return value === null;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'string') return typeof value === 'string';
  return false;
}

function countDecimals(value: number): number {
  if (!Number.isFinite(value)) return -1;
  const text = String(value);
  if (text.includes('e') || text.includes('E')) return -1;
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a === b) return 0;
  return a < b ? -1 : 1;
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
