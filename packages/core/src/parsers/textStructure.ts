/** Bounded structural parsers for the text formats used by structured-output scenarios.
 * They reject malformed nesting and duplicate keys, while leaving unsupported dialect
 * semantics to explicit, separately named contract checks.
 */

export interface MarkupNode {
  name: string;
  attrs: Record<string, string>;
  children: MarkupNode[];
  text: string;
  rawText: string;
}
export interface ParseResult<T> { value?: T; errors: string[] }

export function descendants(node: MarkupNode, name: string): MarkupNode[] {
  return node.children.flatMap(child => [
    ...(child.name.toLowerCase() === name.toLowerCase() ? [child] : []), ...descendants(child, name),
  ]);
}
export const directChildren = (node: MarkupNode, name: string): MarkupNode[] =>
  node.children.filter(child => child.name.toLowerCase() === name.toLowerCase());
export const nodeText = (node: MarkupNode): string => node.text + node.children.map(nodeText).join('');

export function parseMarkup(source: string, html = false): ParseResult<MarkupNode> {
  const errors: string[] = [];
  const root: MarkupNode = { name: '#document', attrs: {}, children: [], text: '', rawText: '' };
  const stack = [root];
  const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const token = /<!--(?:[\s\S]*?)-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/[A-Za-z_][\w.:-]*\s*>|<[A-Za-z_][\w.:-]*(?:"[^"]*"|'[^']*'|[^'">])*?>|[^<]+|</g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(source)) !== null) {
    const raw = match[0];
    if (raw === '<') { errors.push('Unclosed or invalid tag'); continue; }
    if (raw.startsWith('<!--') || raw.startsWith('<?') || /^<!doctype/i.test(raw)) continue;
    if (raw.startsWith('<![CDATA[')) {
      stack.at(-1)!.text += match[1] ?? '';
      stack.at(-1)!.rawText += raw;
      continue;
    }
    if (raw.startsWith('</')) {
      const name = raw.slice(2, -1).trim();
      const current = stack.at(-1);
      if (!current || (html ? current.name.toLowerCase() !== name.toLowerCase() : current.name !== name))
        errors.push(`Mismatched closing tag ${name}`);
      else stack.pop();
      continue;
    }
    if (raw.startsWith('<')) {
      const head = raw.match(/^<([A-Za-z_][\w.:-]*)/);
      if (!head) { errors.push('Invalid opening tag'); continue; }
      const name = html ? head[1].toLowerCase() : head[1];
      const tail = raw.slice(head[0].length, raw.length - 1).replace(/\/\s*$/, '');
      const attrs: Record<string, string> = {};
      const attr = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s=/>]+)))?/g;
      let attrMatch: RegExpExecArray | null;
      while ((attrMatch = attr.exec(tail)) !== null) {
        const key = html ? attrMatch[1].toLowerCase() : attrMatch[1];
        if (key in attrs) errors.push(`Duplicate attribute ${key}`);
        attrs[key] = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
        if (!html && /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(attrs[key]))
          errors.push(`Bare or invalid XML entity in attribute ${key}`);
      }
      if (!html && tail.replace(attr, '').trim()) errors.push(`Invalid attributes on ${name}`);
      const node: MarkupNode = { name, attrs, children: [], text: '', rawText: '' };
      stack.at(-1)!.children.push(node);
      if (!raw.endsWith('/>') && !(html && voidTags.has(name))) stack.push(node);
      continue;
    }
    if (!html && /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(raw)) errors.push('Bare or invalid XML entity');
    stack.at(-1)!.text += raw;
    stack.at(-1)!.rawText += raw;
  }
  if (stack.length !== 1) errors.push(`Unclosed tag ${stack.at(-1)?.name}`);
  if (root.children.length !== 1) errors.push(`Expected one root element, found ${root.children.length}`);
  return { value: root.children[0], errors };
}

function splitTopLevel(value: string, delimiter = ','): string[] {
  const result: string[] = [];
  let quote = '', escaped = false, depth = 0, start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if ('[{('.includes(char)) depth++;
    else if (']})'.includes(char)) depth--;
    else if (char === delimiter && depth === 0) { result.push(value.slice(start, i).trim()); start = i + 1; }
  }
  result.push(value.slice(start).trim());
  return result;
}
function stripComment(line: string): string {
  let quote = '', escaped = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}
function scalar(raw: string): unknown {
  const value = raw.trim();
  if (value === '' || value === '~' || value.toLowerCase() === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"') && value.endsWith('"')) { try { return JSON.parse(value); } catch { return value.slice(1, -1); } }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith('[') && value.endsWith(']')) return splitTopLevel(value.slice(1, -1)).filter(Boolean).map(scalar);
  if (value.startsWith('{') && value.endsWith('}')) {
    const map: Record<string, unknown> = {};
    for (const pair of splitTopLevel(value.slice(1, -1))) {
      const cut = pair.indexOf(':') >= 0 ? pair.indexOf(':') : pair.indexOf('=');
      if (cut > 0) map[pair.slice(0, cut).trim()] = scalar(pair.slice(cut + 1));
    }
    return map;
  }
  return value;
}

interface YamlLine { indent: number; text: string; number: number }
export function parseYamlDocuments(source: string): ParseResult<unknown[]> {
  const errors: string[] = [];
  const blocks: string[][] = [[]];
  for (const line of source.split(/\r?\n/)) {
    if (/^---\s*(?:#.*)?$/.test(line)) { if (blocks.at(-1)!.some(x => x.trim())) blocks.push([]); continue; }
    if (/^\.\.\.\s*$/.test(line)) { blocks.push([]); continue; }
    blocks.at(-1)!.push(line);
  }
  const documents: unknown[] = [];
  for (const block of blocks.filter(lines => lines.some(line => line.trim() && !line.trim().startsWith('#')))) {
    const anchors = new Map<string, unknown>();
    const lines: YamlLine[] = [];
    block.forEach((raw, index) => {
      if (/^\s*\t/.test(raw)) errors.push(`YAML line ${index + 1}: tab indentation`);
      const clean = stripComment(raw).trimEnd();
      if (!clean.trim()) return;
      lines.push({ indent: clean.match(/^ */)![0].length, text: clean.trimStart(), number: index + 1 });
    });
    let index = 0;
    const parseValue = (raw: string, childIndent: number): unknown => {
      const anchor = raw.match(/^&([\w-]+)(?:\s+(.*))?$/);
      if (anchor) {
        const value = anchor[2] ? scalar(anchor[2]) : index < lines.length && lines[index].indent >= childIndent
          ? parseBlock(lines[index].indent) : null;
        anchors.set(anchor[1], value);
        return value;
      }
      const alias = raw.match(/^\*([\w-]+)$/);
      if (alias) {
        if (!anchors.has(alias[1])) errors.push(`Undefined YAML alias ${alias[1]}`);
        return structuredClone(anchors.get(alias[1]) ?? null);
      }
      if (raw === '|' || raw === '>') {
        const content: string[] = [];
        while (index < lines.length && lines[index].indent >= childIndent) content.push(lines[index++].text);
        return raw === '|' ? content.join('\n') : content.join(' ');
      }
      if (!raw && index < lines.length && lines[index].indent >= childIndent) return parseBlock(lines[index].indent);
      return scalar(raw);
    };
    const parseBlock = (indent: number): unknown => {
      const sequence = lines[index]?.text.startsWith('- ');
      const target: unknown[] | Record<string, unknown> = sequence ? [] : {};
      while (index < lines.length && lines[index].indent === indent) {
        const line = lines[index++];
        if (sequence) {
          if (!line.text.startsWith('- ')) { errors.push(`Mixed YAML sequence/mapping at line ${line.number}`); break; }
          const item = line.text.slice(2).trim();
          const pair = item.match(/^(.+?):(?:\s+(.*)|\s*)$/);
          if (pair) {
            const object: Record<string, unknown> = {};
            object[pair[1].trim()] = parseValue(pair[2] ?? '', indent + 2);
            if (index < lines.length && lines[index].indent > indent) {
              const rest = parseBlock(lines[index].indent);
              if (rest && typeof rest === 'object' && !Array.isArray(rest)) Object.assign(object, rest);
            }
            (target as unknown[]).push(object);
          } else (target as unknown[]).push(parseValue(item, indent + 2));
        } else {
          const pair = line.text.match(/^(.+?):(?:\s+(.*)|\s*)$/);
          if (!pair) { errors.push(`Invalid YAML mapping at line ${line.number}`); continue; }
          const key = String(scalar(pair[1].trim()));
          if (key in target) errors.push(`Duplicate YAML key ${key}`);
          (target as Record<string, unknown>)[key] = parseValue(pair[2] ?? '', indent + 1);
        }
        if (index < lines.length && lines[index].indent > indent) {
          errors.push(`Unexpected YAML indentation at line ${lines[index].number}`);
          index++;
        }
      }
      return target;
    };
    documents.push(lines.length ? parseBlock(lines[0].indent) : null);
    if (index < lines.length) errors.push(`Unparsed YAML content at line ${lines[index].number}`);
  }
  return { value: documents, errors };
}

export function parseTomlDocument(source: string): ParseResult<Record<string, unknown>> {
  const errors: string[] = [];
  const root: Record<string, unknown> = {};
  const declaredTables = new Set<string>();
  let current = root;
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]).trim();
    if (!line) continue;
    const section = line.match(/^\[([\w.-]+)\]$/);
    const arrayTable = line.match(/^\[\[([\w.-]+)\]\]$/);
    if (section || arrayTable) {
      const parts = (section ?? arrayTable)![1].split('.');
      if (section && declaredTables.has(section[1])) errors.push(`Duplicate TOML table ${section[1]}`);
      if (section) declaredTables.add(section[1]);
      let parent: Record<string, unknown> = root;
      for (const part of parts.slice(0, -1)) {
        if (!(part in parent)) parent[part] = {};
        if (!parent[part] || typeof parent[part] !== 'object' || Array.isArray(parent[part])) { errors.push(`Invalid TOML table ${part}`); break; }
        parent = parent[part] as Record<string, unknown>;
      }
      const name = parts.at(-1)!;
      if (arrayTable) {
        if (!(name in parent)) parent[name] = [];
        if (!Array.isArray(parent[name])) errors.push(`TOML table ${name} is not an array`);
        else { current = {}; (parent[name] as unknown[]).push(current); }
      } else {
        if (!(name in parent)) parent[name] = {};
        if (!parent[name] || typeof parent[name] !== 'object' || Array.isArray(parent[name])) errors.push(`Invalid TOML table ${name}`);
        else current = parent[name] as Record<string, unknown>;
      }
      continue;
    }
    const key = line.match(/^([\w.-]+)\s*=\s*(.*)$/);
    if (!key) { errors.push(`Invalid TOML line ${i + 1}`); continue; }
    let raw = key[2];
    while (i + 1 < lines.length && (raw.match(/\[/g) ?? []).length > (raw.match(/\]/g) ?? []).length) raw += '\n' + stripComment(lines[++i]);
    if (key[1] in current) errors.push(`Duplicate TOML key ${key[1]}`);
    const value = raw.trim();
    if (!value || (value.startsWith('[') && !value.endsWith(']')) || (value.startsWith('{') && !value.endsWith('}')))
      errors.push(`Invalid TOML value at line ${i + 1}`);
    if (value && !/^(?:["'\[{]|true$|false$|-?\d|\d{4}-\d{2}-\d{2})/.test(value))
      errors.push(`Unsupported or unquoted TOML value at line ${i + 1}`);
    current[key[1]] = scalar(value.startsWith('{') ? value.replace(/([\w.-]+)\s*=/g, '$1:') : value);
  }
  return { value: root, errors };
}

export interface MarkdownBlocks {
  headings: { level: number; text: string; line: number }[];
  fences: { language: string; body: string; line: number }[];
  tables: { rows: string[][]; line: number }[];
  ordered: { number: number; text: string }[];
  quotes: string[];
  separators: number;
}
export function parseMarkdownBlocks(source: string): ParseResult<MarkdownBlocks> {
  const errors: string[] = [];
  const blocks: MarkdownBlocks = { headings: [], fences: [], tables: [], ordered: [], quotes: [], separators: 0 };
  const lines = source.split(/\r?\n/);
  let fence: { language: string; lines: string[]; line: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('```')) {
      if (fence) { blocks.fences.push({ language: fence.language, body: fence.lines.join('\n'), line: fence.line }); fence = null; }
      else fence = { language: line.slice(3).trim(), lines: [], line: i + 1 };
      continue;
    }
    if (fence) { fence.lines.push(lines[i]); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) blocks.headings.push({ level: heading[1].length, text: heading[2], line: i + 1 });
    const ordered = line.match(/^(\d+)\.\s+(.+)$/);
    if (ordered) blocks.ordered.push({ number: Number(ordered[1]), text: ordered[2] });
    if (line.startsWith('> ')) blocks.quotes.push(line.slice(2));
    if (/^(?:---+|\*\*\*+|___+)$/.test(line)) blocks.separators++;
    if (line.startsWith('|') && !lines[i - 1]?.trim().startsWith('|')) {
      const table: string[][] = [];
      for (let j = i; j < lines.length && lines[j].trim().startsWith('|'); j++)
        table.push(lines[j].trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()));
      if (table.length >= 2 && table[1].every(cell => /^:?-{3,}:?$/.test(cell))) blocks.tables.push({ rows: table, line: i + 1 });
    }
  }
  if (fence) errors.push(`Unclosed Markdown fence at line ${fence.line}`);
  return { value: blocks, errors };
}

export interface SqlTokens { tokens: string[]; comments: number; statements: string[][] }
export function tokenizeSql(source: string): ParseResult<SqlTokens> {
  const errors: string[] = [];
  const tokens: string[] = [];
  let comments = 0, i = 0, quote = '', depth = 0;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) { i++; continue; }
    if (source.startsWith('--', i) || source.startsWith('#', i)) {
      comments++; const end = source.indexOf('\n', i); i = end < 0 ? source.length : end + 1; continue;
    }
    if (source.startsWith('/*', i)) {
      comments++; const end = source.indexOf('*/', i + 2);
      if (end < 0) { errors.push('Unclosed SQL comment'); break; }
      i = end + 2; continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char; let value = char; i++;
      while (i < source.length) {
        value += source[i++];
        if (value.at(-1) === quote) {
          if (source[i] === quote) { value += source[i++]; continue; }
          quote = ''; break;
        }
        if (value.at(-1) === '\\' && i < source.length) value += source[i++];
      }
      if (quote) errors.push('Unclosed SQL string');
      tokens.push(char === '`' ? value.slice(1, -1).toUpperCase() : value); continue;
    }
    if (char === '(') depth++;
    if (char === ')') { depth--; if (depth < 0) errors.push('Unmatched SQL closing parenthesis'); }
    const word = source.slice(i).match(/^[A-Za-z_][\w$]*/);
    if (word) { tokens.push(word[0].toUpperCase()); i += word[0].length; continue; }
    const number = source.slice(i).match(/^\d+(?:\.\d+)?/);
    if (number) { tokens.push(number[0]); i += number[0].length; continue; }
    tokens.push(char); i++;
  }
  if (depth !== 0) errors.push('Unbalanced SQL parentheses');
  const statements: string[][] = [];
  let current: string[] = [];
  for (const token of tokens) {
    if (token === ';') { if (current.length) statements.push(current); current = []; }
    else current.push(token);
  }
  if (current.length) statements.push(current);
  return { value: { tokens, comments, statements }, errors };
}

export interface MermaidStructure {
  type: string;
  lines: string[];
  edges: { from: string; to: string; label: string }[];
  entities: Record<string, string[]>;
  participants: string[];
  declarations: string[];
}
export function parseMermaidStructure(source: string): ParseResult<MermaidStructure> {
  const errors: string[] = [];
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const type = lines[0]?.split(/\s+/)[0] ?? '';
  const edges: MermaidStructure['edges'] = [];
  const entities: Record<string, string[]> = {};
  const participants: string[] = [], declarations: string[] = [];
  let currentEntity: string | null = null;
  let depth = 0;
  for (const line of lines.slice(1)) {
    const stateBlock = line.match(/^state\s+([A-Za-z_][\w]*)\s*\{$/);
    if (stateBlock) { depth++; declarations.push(line); continue; }
    const entity = line.match(/^(?:class\s+)?([A-Za-z_][\w]*)\s*\{$/);
    if (entity) { currentEntity = entity[1]; entities[currentEntity] = []; depth++; continue; }
    if (line === '}') { if (depth === 0) errors.push('Unmatched Mermaid block close'); currentEntity = null; depth--; continue; }
    if (currentEntity) { entities[currentEntity].push(line); continue; }
    const participant = line.match(/^(?:participant|actor)\s+([A-Za-z_][\w]*)/);
    if (participant) { participants.push(participant[1]); continue; }
    const relation = line.match(/^([A-Za-z_][\w]*)(?:\s+"[^"]+")?\s+([^\s]+)(?:\s+"[^"]+")?\s+([A-Za-z_][\w]*)\s*:\s*(.*)$/);
    if (relation && /--|\.\./.test(relation[2])) {
      edges.push({ from: relation[1], to: relation[3], label: relation[4] }); continue;
    }
    const flow = line.match(/^([A-Za-z_][\w]*|\[\*\])(?:\[[^\]]*\]|\{[^}]*\}|\([^)]*\))?\s+[-.=ox|<>]+(?:\|[^|]*\|)?\s+([A-Za-z_][\w]*|\[\*\])/);
    if (flow) { edges.push({ from: flow[1], to: flow[2], label: line }); continue; }
    const sequence = line.match(/^([A-Za-z_][\w]*)\s*[-.]+>>?\s*([A-Za-z_][\w]*)\s*:\s*(.*)$/);
    if (sequence) { edges.push({ from: sequence[1], to: sequence[2], label: sequence[3] }); continue; }
    declarations.push(line);
  }
  if (depth !== 0) errors.push('Unclosed Mermaid block');
  return { value: { type, lines, edges, entities, participants, declarations }, errors };
}
