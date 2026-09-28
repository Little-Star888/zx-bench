import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import { isDeepStrictEqual } from 'node:util';
import type { CriterionResult, StructuredContractMetrics } from '@zxbench/types';
import type { Evaluator } from './index.js';

export type ContractSchema = boolean | Record<string, unknown>;
export interface StructuredContractRequirements {
  format: 'json';
  dialect: 'draft-07' | '2020-12';
  schema: ContractSchema;
  contentSchema?: ContractSchema;
  assertions?: Array<{ pointer: string; expected: unknown; description: string }>;
  references?: Record<string, ContractSchema>;
  formatAssertions: boolean;
  family: string;
  output_policy: 'raw_only';
}

/** Compile only frozen task schemas. AJV has no network loader or data mutation options. */
export function prepareStructuredContract(req: StructuredContractRequirements) {
  if (req.format !== 'json' || req.output_policy !== 'raw_only'
    || !['draft-07', '2020-12'].includes(req.dialect) || typeof req.formatAssertions !== 'boolean'
    || !req.family || req.schema === undefined) throw new Error('Incomplete structured contract');
  const dialectUri = req.dialect === 'draft-07'
    ? 'http://json-schema.org/draft-07/schema#' : 'https://json-schema.org/draft/2020-12/schema';
  const schemas = [req.schema, req.contentSchema, ...Object.values(req.references ?? {})].filter(s=>s!==undefined);
  for (const schema of schemas) {
    if (typeof schema !== 'boolean' && (!schema || Array.isArray(schema) || typeof schema !== 'object')) {
      throw new Error('Schema must be an object or boolean');
    }
    if (typeof schema === 'object' && schema.$schema && schema.$schema !== dialectUri) {
      throw new Error(`Schema dialect disagrees with ${req.dialect}`);
    }
  }
  const Constructor = req.dialect === '2020-12' ? Ajv2020 : Ajv;
  const ajv = new Constructor({ allErrors: true, strictSchema: true, strictTypes: false,
    strictTuples: false, strictRequired: false, strictNumbers: true, allowMatchingProperties: true, validateFormats: req.formatAssertions,
    coerceTypes: false, useDefaults: false, removeAdditional: false, addUsedSchema: false });
  addFormats(ajv);
  for (const [uri, schema] of Object.entries(req.references ?? {})) ajv.addSchema(schema, uri);
  const schema = ajv.compile(req.schema);
  const content = req.contentSchema === undefined ? undefined : ajv.compile(req.contentSchema);
  for (const a of req.assertions ?? []) {
    if (!a || typeof a.pointer !== 'string' || typeof a.description !== 'string' || !a.description
      || !Object.hasOwn(a, 'expected') || (a.pointer !== '' && !a.pointer.startsWith('/'))
      || /~(?:[^01]|$)/.test(a.pointer)) throw new Error('Invalid JSON Pointer assertion');
  }
  return { schema, content };
}

function atPointer(data: unknown, pointer: string): { found: boolean; value?: unknown } {
  if (pointer === '') return { found: true, value: data };
  let value: unknown = data;
  for (const encoded of pointer.slice(1).split('/')) {
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return { found: false };
    value = (value as Record<string, unknown>)[key];
  }
  return { found: true, value };
}

function details(validate: ValidateFunction): string {
  return (validate.errors ?? []).slice(0, 12).map(e=>`${e.instancePath || '/'} ${e.keyword}: ${e.message}`).join('; ');
}

const cache = new Map<string, ReturnType<typeof prepareStructuredContract>>();
export const structuredContractEvaluator: Evaluator = {
  name: 'structured_contract', version: 'structured_contract_v1',
  async evaluate(scenario, output) {
    const req = scenario.requirements as unknown as StructuredContractRequirements;
    const criteria: CriterionResult[] = [];
    const check = (id: string, description: string, pass: boolean, evidence: string) => {
      criteria.push({ id: `structured_${id}`, description, status: pass ? 'pass' : 'fail',
        critical: true, evidence, source: 'verified' });
    };
    let validators: ReturnType<typeof prepareStructuredContract>;
    try {
      const key = JSON.stringify(req);
      validators = cache.get(key) ?? prepareStructuredContract(req);
      if (!cache.has(key)) {
        if (cache.size >= 64) cache.delete(cache.keys().next().value!);
        cache.set(key, validators);
      }
    } catch (error) {
      return { totalScore: 0, environmentError: true, humanReviewRequired: true, axisScores: {},
        criterionResults: [{ id:'structured_contract_available', description:'Frozen task contract compiles',
          status:'unmeasured',critical:true,source:'unmeasured',evidence:String(error) }],
        evidence: [`STRUCTURED_CONTRACT_UNAVAILABLE: ${String(error)}`] };
    }
    let data: unknown;
    let syntaxValid = false;
    try { data = JSON.parse(output); syntaxValid = true; } catch { /* raw output fails; no repairs */ }
    check('raw_json', 'Entire raw response is valid JSON', syntaxValid, syntaxValid ? 'Parsed original response' : 'Invalid or empty raw JSON');
    const schemaValid = syntaxValid && validators.schema(data);
    check('standard_schema', `Schema compliance (${req.dialect})`, schemaValid,
      !syntaxValid ? 'Blocked by invalid JSON' : schemaValid ? 'Standard validator accepted' : details(validators.schema));
    const hasContent = !!validators.content || !!req.assertions?.length;
    let contentValid = syntaxValid;
    if (validators.content) {
      const passed = syntaxValid && validators.content(data);
      contentValid &&= passed;
      check('content_schema', 'All declared content constraints', passed,
        !syntaxValid ? 'Blocked by invalid JSON' : passed ? 'Content contract accepted' : details(validators.content));
    }
    for (const [i, a] of (req.assertions ?? []).entries()) {
      const actual = syntaxValid ? atPointer(data, a.pointer) : { found: false };
      const passed = actual.found && isDeepStrictEqual(actual.value, a.expected);
      contentValid &&= passed;
      check(`content_${i}`, a.description, passed, passed ? `Matched ${a.pointer || '/'}` : `Value mismatch or missing at ${a.pointer || '/'}`);
    }
    const complete = criteria.every(c=>c.status === 'pass');
    const metrics: StructuredContractMetrics = { version:1, family:req.family,
      validator:'ajv@8.20.0+ajv-formats@3.0.1', dialect:req.dialect,
      syntaxValid, schemaValid, contentValid:hasContent ? contentValid : null, complete,
      partialScore:100 * criteria.filter(c=>c.status==='pass').length / criteria.length };
    return { totalScore: complete ? 100 : 0, deterministicScore:complete ? 100 : 0,
      formatParseSuccess:syntaxValid, structuredContractMetrics:metrics,
      axisScores:{ raw_json: syntaxValid ? 100 : 0, standard_schema:schemaValid ? 100 : 0,
        ...(hasContent ? { content_fidelity:contentValid ? 100 : 0 } : {}) },
      axisEvidence:{raw_json:'verified',standard_schema:'verified',content_fidelity:hasContent?'verified':'unmeasured'},
      axisCoverage:1, criterionResults:criteria, safetyLevel:'safe',
      evidence:[`STRUCTURED_CONTRACT_RESULT: ${complete ? 'pass' : 'fail'}`,
        ...(!output.trim() ? ['STRUCTURED_EMPTY_ANSWER: successful request returned no answer'] : [])] };
  },
};
