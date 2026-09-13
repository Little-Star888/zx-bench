import { isDeepStrictEqual } from 'node:util';
import type { JsonValue } from './isolatedJson.js';

/** Host-owned data predicates. No code, regex, coercion or candidate comparator. */
export type JsonValuePredicate = { equals: JsonValue } | { all: (
  { path: (string | number)[]; equals: JsonValue }
  | { path: (string | number)[]; approx: { value: number; absoluteTolerance: number; inclusive: boolean } }
)[] };
const record = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object'
  && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const keys = (v: object, expected: string[]) => Object.keys(v).length === expected.length
  && expected.every(k => Object.hasOwn(v, k));
export function validJsonValuePredicate(v: unknown): v is JsonValuePredicate {
  if (!record(v)) return false;
  // The enclosing contract validates the complete tree as finite JSON first.
  if (keys(v, ['equals'])) return true;
  if (!keys(v, ['all']) || !Array.isArray(v.all) || !v.all.length || v.all.length > 100) return false;
  return v.all.every((check: unknown) => {
    if (!record(check) || !Array.isArray(check.path) || check.path.length > 32
      || !check.path.every((p: unknown) => typeof p === 'string'
        || (typeof p === 'number' && Number.isSafeInteger(p) && p >= 0))) return false;
    if (keys(check, ['path', 'equals'])) return true;
    const a = check.approx;
    return keys(check, ['path', 'approx']) && record(a) && keys(a, ['value', 'absoluteTolerance', 'inclusive'])
      && typeof a.value === 'number' && Number.isFinite(a.value)
      && typeof a.absoluteTolerance === 'number' && Number.isFinite(a.absoluteTolerance)
      && a.absoluteTolerance > 0 && typeof a.inclusive === 'boolean';
  });
}
export function matchesJsonValuePredicate(value: JsonValue, predicate: JsonValuePredicate): boolean {
  if ('equals' in predicate) return isDeepStrictEqual(value, predicate.equals);
  return predicate.all.every(check => {
    let actual: JsonValue = value;
    for (const key of check.path) {
      if (actual === null || typeof actual !== 'object' || !Object.hasOwn(actual, key)) return false;
      actual = (actual as Record<string | number, JsonValue>)[key];
    }
    if ('equals' in check) return isDeepStrictEqual(actual, check.equals);
    if (typeof actual !== 'number' || !Number.isFinite(actual)) return false;
    const delta = Math.abs(actual - check.approx.value);
    return check.approx.inclusive ? delta <= check.approx.absoluteTolerance : delta < check.approx.absoluteTolerance;
  });
}
