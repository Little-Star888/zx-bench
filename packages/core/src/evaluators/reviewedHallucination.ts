import type { Scenario, ScenarioResult, AxisEvidence } from '@zxbench/types';

/** Only fully parsed, context-free answers are deterministic facts. Prose needs semantic review. */
export interface OfflineAnswer {
  kind: 'choice' | 'fact' | 'quantity';
  answers?: string[];
  choices?: string[];
  value?: number;
  tolerance?: number;
  units?: Record<string, number>;
}
export interface ReviewedRubric {
  version: '5.0';
  criteria: Array<{ id: string; description: string; weight: number }>;
  criticalErrors: string[];
  reference: string;
}

export function reviewedHallucination(scenario: Scenario, output: string): Partial<ScenarioResult> {
  const req = scenario.requirements as unknown as { offlineAnswer?: OfflineAnswer };
  const offline = req.offlineAnswer;
  const candidate = scenario.answerFirst === true
    ? output.split(/\r?\n/).find(line => line.trim().length > 0) ?? ''
    : output;
  const text = expandSuperscriptExponent(candidate).normalize('NFKC').trim()
    .replace(/\*\*/g, '')
    .replace(/^(?:ANSWER|最终答案|答案|最终结果|结果)\s*(?:是|为|[:：])\s*/i, '')
    .replace(/[。.!！]+$/, '').trim();
  let correct: boolean | undefined;
  // In answer-first mode a model may put a label-only `答案：` line before a
  // prose answer. That is not an empty response and must be deferred to the
  // semantic Judge instead of becoming a deterministic false-answer veto.
  if (!text) correct = output.trim().length === 0 ? false : undefined;
  else if (offline?.kind === 'fact' && offline.answers?.some(a => factMatches(text, a, scenario.answerFirst === true))) correct = true;
  else if (offline?.kind === 'choice') {
    // Whole-response grammar: neither letters inside prose nor repetition of the question count.
    if (/^[A-Z](?:\s*[,，、;；]\s*[A-Z])*$/.test(text)) {
      const selected = text.split(/\s*[,，、;；]\s*/);
      if (selected.every(a => offline.choices?.includes(a))) {
        correct = new Set(selected).size === selected.length && selected.slice().sort().join() === offline.answers?.slice().sort().join();
      }
    }
  } else if (offline?.kind === 'quantity') {
    const normalized = text.replace(/^(?:约为|大约为|大约|约|大概|approximately|about)\s*/i, '')
      .replace(/三十万/g, '300000').replace(/三百六十五点二五/g, '365.25').replace(/三百六十五/g, '365')
      .replace(/(\d+(?:\.\d+)?)\s*[×x]\s*10\s*\^\s*([+-]?\d+)/g, '$1e$2');
    const values = scenario.answerFirst === true
      ? extractQuantities(normalized, offline)
      : extractWholeQuantity(normalized, offline);
    if (values.length > 0) {
      correct = values.every(n => Number.isFinite(n) && Math.abs(n - offline.value!) <= offline.tolerance!);
    }
  }
  if (correct === undefined) return {
    totalScore: 0, axisScores: {}, axisEvidence: { factuality: 'unmeasured' as AxisEvidence }, axisCoverage: 0,
    evidence: ['SEMANTIC_JUDGE_REQUIRED: no deterministic verdict; apply every reviewed rubric criterion'], safetyLevel: 'safe',
  };
  return {
    totalScore: correct ? 100 : 0, axisScores: { factuality: correct ? 100 : 0 }, axisCoverage: 1,
    axisEvidence: { factuality: 'rule' }, safetyLevel: 'safe',
    evidence: [correct ? 'DETERMINISTIC_FACT: complete offline answer verified' : 'DETERMINISTIC_VETO: complete offline answer disproved',
      `HALLUCINATION_LABEL:${correct ? 'correct' : 'hallucination'}`],
  };
}

function expandSuperscriptExponent(text: string): string {
  const digits: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' };
  return text.replace(/([×x]\s*10)([⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+)/g, (_match, base: string, exponent: string) =>
    `${base}^${[...exponent].map(char => digits[char]).join('')}`);
}

function factMatches(text: string, answer: string, answerFirst: boolean): boolean {
  const actual = text.toLowerCase().replace(/[\s`'"“”‘’。.!！]+/g, '');
  const expected = answer.normalize('NFKC').toLowerCase().replace(/[\s`'"“”‘’。.!！]+/g, '');
  if (actual === expected) return true;
  if (!answerFirst) return false;
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^不])(?:是|为|[:：])${escaped}$`, 'i').test(actual);
}

function extractWholeQuantity(text: string, offline: OfflineAnswer): number[] {
  const parsed = text.match(/^([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(万)?\s*([^\d]+?)\s*(?:左右)?$/i);
  if (!parsed) return [];
  const factor = offline.units?.[parsed[3].trim()];
  return factor === undefined ? [] : [Number(parsed[1]) * (parsed[2] ? 10000 : 1) * factor];
}

function extractQuantities(text: string, offline: OfflineAnswer): number[] {
  const units = Object.keys(offline.units ?? {}).sort((a, b) => b.length - a.length);
  if (units.length === 0) return [];
  const unitPattern = units.map(unit => unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const pattern = new RegExp(`([+-]?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)(万)?\\s*(${unitPattern})`, 'gi');
  return [...text.matchAll(pattern)].map(match => Number(match[1]) * (match[2] ? 10000 : 1) * offline.units![match[3]]);
}
