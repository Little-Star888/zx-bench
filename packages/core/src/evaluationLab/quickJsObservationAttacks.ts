/** Independent adversarial controls for the EXPERIMENTAL QuickJS observer.
 *
 * All snippets use `target` as the entrypoint and must run inside the hardened
 * container/WASM boundary, never through host eval, import, or node:vm. A false
 * shouldPass means the candidate must NOT satisfy the supplied expectation;
 * this does not require a particular rejection message or process exit code.
 * No fixture represents Python coverage or an independently approved gold.
 */
import type { JsonValue } from '../execution/isolatedJson.js';
import type { QuickJsExpected } from '../execution/quickJsObservation.js';

export interface QuickJsObservationAttack {
  id: string;
  code: string;
  calls: JsonValue[][];
  expected: QuickJsExpected[];
  shouldPass: boolean;
  expectedObserverStatus?: string;
  notes?: string;
  documentedLimit?: boolean;
}

const rangeError: QuickJsExpected = { outcome: { kind: 'throw', errorType: 'RangeError' } };
const value = (v: JsonValue): QuickJsExpected => ({ outcome: { kind: 'return', value: v } });
const unchangedLength: QuickJsExpected = { outcome: { kind: 'return', value: 2 }, argumentsAfter: [[1, 2]] };
const originalArray: QuickJsExpected = {
  outcome: { kind: 'return', value: [1, 2] }, argumentsAfter: [[1, 2]], sameArgument: [{ index: 0, same: true }],
};
const nestedValue = (depth: number): JsonValue => {
  let result: JsonValue = 0;
  for (let i = 0; i < depth; i++) result = { next: result };
  return result;
};

export const QUICKJS_OBSERVATION_ATTACKS: QuickJsObservationAttack[] = [
  {
    id: 'positive-plain-return', code: 'function target(n) { return {ok: true, value: n + 1}; }',
    calls: [[1]], expected: [value({ ok: true, value: 2 })], shouldPass: true,
  },
  {
    id: 'negative-wrong-return', code: 'function target(n) { return {ok: true, value: n}; }',
    calls: [[1]], expected: [value({ ok: true, value: 2 })], shouldPass: false,
  },
  {
    id: 'positive-native-range-error', code: 'function target() { throw new RangeError("invalid size"); }',
    calls: [[0]], expected: [rangeError], shouldPass: true,
  },
  {
    id: 'positive-native-error-subclass', code: 'class SizeError extends RangeError {} function target() { throw new SizeError("invalid size"); }',
    calls: [[0]], expected: [rangeError], shouldPass: true,
  },
  {
    id: 'positive-error-name-is-not-type', code: 'function target() { const e = new RangeError("invalid size"); e.name = "Error"; throw e; }',
    calls: [[0]], expected: [rangeError], shouldPass: true,
  },
  {
    id: 'negative-error-name-forgery', code: 'function target() { const e = new Error("fake"); e.name = "RangeError"; throw e; }',
    calls: [[0]], expected: [rangeError], shouldPass: false,
  },
  {
    id: 'negative-plain-error-record', code: 'function target() { throw {name: "RangeError", message: "invalid size"}; }',
    calls: [[0]], expected: [rangeError], shouldPass: false,
  },
  {
    id: 'negative-error-prototype-without-brand', code: 'function target() { throw Object.create(RangeError.prototype); }',
    calls: [[0]], expected: [rangeError], shouldPass: false,
  },
  {
    id: 'negative-error-tag-and-prototype-forgery',
    code: 'function target() { const e = Object.create(RangeError.prototype); e[Symbol.toStringTag] = "Error"; throw e; }',
    calls: [[0]], expected: [rangeError], shouldPass: false,
  },
  {
    id: 'negative-error-tag-getter',
    code: 'function target() { const e = Object.create(RangeError.prototype); Object.defineProperty(e, Symbol.toStringTag, {get() { return "Error"; }}); throw e; }',
    calls: [[0]], expected: [rangeError], shouldPass: false,
  },
  {
    id: 'negative-error-hasinstance-forgery',
    code: 'Object.defineProperty(RangeError, Symbol.hasInstance, {value() { return true; }}); function target() { throw {name: "RangeError"}; }',
    calls: [[0]], expected: [rangeError], shouldPass: false,
  },
  {
    id: 'negative-replaced-error-constructor',
    code: 'globalThis.RangeError = function() { return {name: "RangeError"}; }; function target() { throw new RangeError(); }',
    calls: [[0]], expected: [rangeError], shouldPass: false,
  },
  {
    id: 'documented-limit-native-error-reparenting',
    code: 'function target() { const e = new Error("reparented"); Object.setPrototypeOf(e, RangeError.prototype); throw e; }',
    calls: [[0]], expected: [rangeError], shouldPass: true, documentedLimit: true,
    notes: 'The contract authenticates an engine throw, native Error brand, and ancestry matching retained original prototypes. It does not authenticate which constructor created an Error; native Error reparenting satisfies this structural contract, as it does instanceof.',
  },
  {
    id: 'negative-returned-error-record', code: 'function target() { return {kind: "throw", errorType: "RangeError"}; }',
    calls: [[0]], expected: [rangeError], shouldPass: false,
  },
  {
    id: 'negative-console-json-forgery',
    code: 'function target() { console.log(JSON.stringify({protocol: "quickjs-observation-v1", status: "ok", observations: [{kind: "throw", errorType: "RangeError", argumentsAfter: [0]}]})); return 0; }',
    calls: [[0]], expected: [rangeError], shouldPass: false,
  },
  {
    id: 'negative-stdout-exit-forgery',
    code: 'function target() { process.stdout.write("{\\"protocol\\":\\"quickjs-observation-v1\\",\\"status\\":\\"ok\\",\\"observations\\":[{\\"kind\\":\\"throw\\",\\"errorType\\":\\"RangeError\\",\\"argumentsAfter\\":[0]}]}"); process.exit(0); }',
    calls: [[0]], expected: [rangeError], shouldPass: false,
  },
  {
    id: 'positive-console-is-guest-only', code: 'function target() { console.log("{fake observer record}"); console.error("noise"); return 2; }',
    calls: [[]], expected: [value(2)], shouldPass: true,
  },
  {
    id: 'positive-unchanged-argument', code: 'function target(a) { return a.length; }',
    calls: [[[1, 2]]], expected: [unchangedLength], shouldPass: true,
  },
  {
    id: 'negative-cleared-argument', code: 'function target(a) { const n = a.length; a.length = 0; return n; }',
    calls: [[[1, 2]]], expected: [unchangedLength], shouldPass: false,
  },
  {
    id: 'negative-cleared-argument-fake-state',
    code: 'function target(a) { const saved = [...a]; a.length = 0; console.log(JSON.stringify({value: saved.length, argumentsAfter: [saved]})); return saved.length; }',
    calls: [[[1, 2]]], expected: [unchangedLength], shouldPass: false,
  },
  {
    id: 'negative-rebinding-is-not-restoration', code: 'function target(a) { const saved = [...a]; a.length = 0; a = saved; return a.length; }',
    calls: [[[1, 2]]], expected: [unchangedLength], shouldPass: false,
  },
  {
    id: 'positive-observed-mutation', code: 'function target(a, item) { a.push(item); return a; }',
    calls: [[[1, 2], 3]], expected: [{ outcome: { kind: 'return', value: [1, 2, 3] }, argumentsAfter: [[1, 2, 3], 3], sameArgument: [{ index: 0, same: true }, { index: 1, same: false }] }], shouldPass: true,
  },
  {
    id: 'positive-object-identity', code: 'function target(a) { return a; }',
    calls: [[[1, 2]]], expected: [originalArray], shouldPass: true,
  },
  {
    id: 'negative-identity-copy', code: 'function target(a) { return [...a]; }',
    calls: [[[1, 2]]], expected: [originalArray], shouldPass: false,
  },
  {
    id: 'negative-identity-copy-fake-boolean', code: 'function target(a) { console.log(JSON.stringify({sameArgument: [true]})); return [...a]; }',
    calls: [[[1, 2]]], expected: [originalArray], shouldPass: false,
  },
  {
    id: 'negative-return-getter-restores-argument',
    code: 'function target(a) { a.length = 0; return {get count() { a.push(1, 2); return 2; }}; }',
    calls: [[[1, 2]]], expected: [{ outcome: { kind: 'return', value: { count: 2 } }, argumentsAfter: [[1, 2]] }], shouldPass: false,
    notes: 'Reading a candidate getter would execute candidate code during observation and conceal the destructive mutation. Accessor-bearing values must be rejected without invoking the getter.',
  },
  {
    id: 'negative-argument-getter-restores-state',
    code: 'function target(a) { a.length = 0; Object.defineProperty(a, "0", {enumerable: true, configurable: true, get() { Object.defineProperty(a, "0", {value: 1, enumerable: true, writable: true, configurable: true}); a[1] = 2; return 1; }}); a.length = 2; return 2; }',
    calls: [[[1, 2]]], expected: [unchangedLength], shouldPass: false,
  },
  {
    id: 'negative-own-tojson', code: 'function target() { return {actual: 0, toJSON() { return {actual: 42}; }}; }',
    calls: [[]], expected: [value({ actual: 42 })], shouldPass: false,
  },
  {
    id: 'positive-inherited-tojson-not-invoked',
    code: 'Object.prototype.toJSON = function() { throw new Error("observer invoked guest code"); }; function target() { return {actual: 2}; }',
    calls: [[]], expected: [value({ actual: 2 })], shouldPass: true,
  },
  {
    id: 'negative-json-and-prototype-pollution',
    code: 'JSON.stringify = () => "42"; Object.prototype.toJSON = () => 42; Object.prototype.valueOf = () => 42; function target() { return 0; }',
    calls: [[]], expected: [value(42)], shouldPass: false,
  },
  {
    id: 'positive-null-prototype-data', code: 'function target() { const a = Object.create(null); a.answer = 42; return a; }',
    calls: [[]], expected: [value({ answer: 42 })], shouldPass: true,
  },
  {
    id: 'negative-sparse-array-is-not-null', code: 'function target() { return [1, , 3]; }',
    calls: [[]], expected: [value([1, null, 3])], shouldPass: false,
    notes: 'JSON.stringify converts array holes into null; the observer must not collapse these distinct outcomes.',
  },
  {
    id: 'negative-sparse-argument-is-not-null', code: 'function target(a) { delete a[1]; return 2; }',
    calls: [[[1, 2]]], expected: [{ outcome: { kind: 'return', value: 2 }, argumentsAfter: [[1, null]] }], shouldPass: false,
  },
  {
    id: 'negative-cyclic-return', code: 'function target() { const a = {}; a.self = a; return a; }',
    calls: [[]], expected: [value({})], shouldPass: false,
  },
  {
    id: 'negative-nan-is-not-null', code: 'function target() { return NaN; }',
    calls: [[]], expected: [value(null)], shouldPass: false,
  },
  {
    id: 'negative-infinity-is-not-null', code: 'function target() { return Infinity; }',
    calls: [[]], expected: [value(null)], shouldPass: false,
  },
  {
    id: 'negative-minus-zero-is-not-zero', code: 'function target() { return -0; }',
    calls: [[]], expected: [value(0)], shouldPass: false,
  },
  {
    id: 'negative-symbol-key-must-not-disappear', code: 'function target() { return {visible: 1, [Symbol("hidden")]: 2}; }',
    calls: [[]], expected: [value({ visible: 1 })], shouldPass: false,
  },
  {
    id: 'negative-symbol-value-must-not-disappear', code: 'function target() { return {visible: 1, hidden: Symbol("hidden")}; }',
    calls: [[]], expected: [value({ visible: 1 })], shouldPass: false,
  },
  {
    id: 'negative-nonenumerable-must-not-disappear',
    code: 'function target() { const a = {visible: 1}; Object.defineProperty(a, "hidden", {value: 2, enumerable: false}); return a; }',
    calls: [[]], expected: [value({ visible: 1 })], shouldPass: false,
  },
  {
    id: 'negative-array-extra-property-must-not-disappear', code: 'function target() { const a = [1, 2]; a.hidden = 3; return a; }',
    calls: [[]], expected: [value([1, 2])], shouldPass: false,
  },
  {
    id: 'negative-depth-budget', code: 'function target() { let a = 0; for (let i = 0; i < 34; i++) a = {next: a}; return a; }',
    calls: [[]], expected: [value(null)], shouldPass: false, expectedObserverStatus: 'observer_operation_failed',
    notes: 'The small expectation keeps the contract valid so the candidate actually runs. Assert observer_operation_failed to prove that observation rejects the 34-level result. This is an explicit protocol limit, not evidence of an incorrect algorithm.',
  },
  {
    id: 'positive-nested-json-within-budget', code: 'function target() { let a = 0; for (let i = 0; i < 20; i++) a = {next: a}; return a; }',
    calls: [[]], expected: [value(nestedValue(20))], shouldPass: true,
  },
  {
    id: 'negative-graph-node-budget', code: 'function target() { return Array.from({length: 100}, () => Array.from({length: 100}, () => 0)); }',
    calls: [[]], expected: [value(null)], shouldPass: false, expectedObserverStatus: 'observer_operation_failed',
    notes: 'The small expectation keeps the contract valid so the candidate actually runs. The 10,101-node JSON tree has no oversized individual array and stays below the output byte cap; assert observer_operation_failed to verify enforcement of the total traversal-node budget.',
  },
  {
    id: 'positive-unicode-nul-lone-surrogates', code: 'function target(a) { return a; }',
    calls: [[['a\u0000b', '繁體🚀', '\ud800', '\udfff']]],
    expected: [{ outcome: { kind: 'return', value: ['a\u0000b', '繁體🚀', '\ud800', '\udfff'] }, argumentsAfter: [['a\u0000b', '繁體🚀', '\ud800', '\udfff']], sameArgument: [{ index: 0, same: true }] }], shouldPass: true,
  },
  {
    id: 'positive-unicode-object-keys', code: 'function target(a) { return a; }',
    calls: [[{ 'nul\u0000key': '\ud800', '\udfff': '汉字🚀' }]],
    expected: [value({ 'nul\u0000key': '\ud800', '\udfff': '汉字🚀' })], shouldPass: true,
  },
  {
    id: 'negative-nul-truncation', code: 'function target() { return "a\\u0000evil"; }',
    calls: [[]], expected: [value('a')], shouldPass: false,
  },
  {
    id: 'positive-function-constructor-stays-in-guest',
    code: 'function target() { return Function("return [typeof process, typeof require, typeof fetch].join(\\",\\")")(); }',
    calls: [[]], expected: [value('undefined,undefined,undefined')], shouldPass: true,
  },
  {
    id: 'positive-argument-constructor-stays-in-guest',
    code: 'function target(a) { const realm = a.constructor.constructor("return globalThis")(); return [typeof realm.Proxy, typeof realm.Map, typeof realm.process]; }',
    calls: [[{}], [[1, 2]]], expected: [value(['undefined', 'undefined', 'undefined']), value(['undefined', 'undefined', 'undefined'])], shouldPass: true,
    notes: 'Both object and array argument constructor chains must remain in the candidate realm. Map is intentionally absent in the guest but enabled in the trusted service realm, so this probe distinguishes more than just Node host escape.',
  },
  {
    id: 'positive-guest-builtin-pollution-cannot-replace-observer',
    code: 'Object.getOwnPropertyDescriptor = () => { throw new Error("guest descriptor used"); }; Array.prototype.map = () => { throw new Error("guest map used"); }; JSON.stringify = () => { throw new Error("guest stringify used"); }; function target() { return {answer: 42, items: [1, 2]}; }',
    calls: [[]], expected: [value({ answer: 42, items: [1, 2] })], shouldPass: true,
    notes: 'The observer must use its private service-context intrinsics and host bridge, not guest replacements.',
  },
  {
    id: 'negative-function-host-escape',
    code: 'function target() { Function("return this")().process.mainModule.require("node:fs").readFileSync("/workspace/input.json", "utf8"); return "host-capability-acquired"; }',
    calls: [[]], expected: [value('host-capability-acquired')], shouldPass: false,
  },
  {
    id: 'positive-proxy-capability-absent', code: 'function target() { return typeof Proxy; }',
    calls: [[]], expected: [value('undefined')], shouldPass: true,
  },
  {
    id: 'negative-proxy-observation-trap', code: 'function target() { return new Proxy({answer: 0}, {get() { return 42; }, getOwnPropertyDescriptor() { return {value: 42, enumerable: true, configurable: true}; }}); }',
    calls: [[]], expected: [value({ answer: 42 })], shouldPass: false,
  },
  {
    id: 'negative-static-import-initialization', code: 'import fs from "node:fs"; function target() { throw new RangeError("should not run"); }',
    calls: [[]], expected: [rangeError], shouldPass: false,
  },
  {
    id: 'negative-dynamic-import', code: 'function target() { import("node:fs"); return 1; }',
    calls: [[]], expected: [value(1)], shouldPass: false,
  },
  {
    id: 'negative-load-throw-is-not-call-throw', code: 'throw new RangeError("initialization failed"); function target() { return 0; }',
    calls: [[0]], expected: [rangeError], shouldPass: false,
  },
  {
    id: 'negative-load-syntax-error-is-not-call-throw', code: 'function target( { definitely invalid syntax',
    calls: [[]], expected: [{ outcome: { kind: 'throw', errorType: 'SyntaxError' } }], shouldPass: false,
  },
  {
    id: 'negative-infinite-loop-is-not-call-error', code: 'function target() { while (true) {} }',
    calls: [[]], expected: [{ outcome: { kind: 'throw', errorType: 'Error' } }], shouldPass: false,
  },
  {
    id: 'negative-recursion-is-not-call-error', code: 'function target() { return target(); }',
    calls: [[]], expected: [{ outcome: { kind: 'throw', errorType: 'Error' } }], shouldPass: false,
    notes: 'QuickJS resource/stack exhaustion is not a genuine task-level expected exception.',
  },
  {
    id: 'negative-oom-is-not-call-error', code: 'function target() { const hold = []; for (;;) hold.push(new Array(10000).fill("x".repeat(10000))); }',
    calls: [[]], expected: [{ outcome: { kind: 'throw', errorType: 'Error' } }], shouldPass: false,
    notes: 'The engine memory limit must remain a failed execution, not credit for an expected Error.',
  },
  {
    id: 'negative-async-return', code: 'async function target() { return 1; }',
    calls: [[]], expected: [value(1)], shouldPass: false,
  },
  {
    id: 'negative-pending-job-after-return', code: 'function target() { Promise.resolve().then(() => 1); return 1; }',
    calls: [[]], expected: [value(1)], shouldPass: false,
  },
  {
    id: 'negative-never-settling-promise', code: 'function target() { return new Promise(() => {}); }',
    calls: [[]], expected: [value(null)], shouldPass: false,
  },
  {
    id: 'negative-promise-reparented-as-plain-object',
    code: 'function target() { const p = Promise.resolve(1); Object.setPrototypeOf(p, Object.prototype); return p; }',
    calls: [[]], expected: [value({})], shouldPass: false, expectedObserverStatus: 'async_not_supported',
    notes: 'Changing a Promise prototype does not remove its engine-internal Promise state. Reject by the native Promise observation, not only by its current prototype.',
  },
  {
    id: 'negative-pending-module-promise-fake-export',
    code: 'Promise.prototype.zxEntry = () => 42; await new Promise(() => {}); function target() { return 0; }',
    calls: [[]], expected: [value(42)], shouldPass: false, expectedObserverStatus: 'async_not_supported',
    notes: 'An unfinished top-level-await module may evaluate to a Promise. Its inherited zxEntry property must never be accepted as a completed module namespace export.',
  },
  {
    id: 'documented-limit-discarded-rejected-promise', code: 'function target() { Promise.reject(1); return 1; }',
    calls: [[]], expected: [value(1)], shouldPass: true, documentedLimit: true,
    notes: 'A discarded already-rejected Promise can leave neither an observable Promise result nor a queued job. The protocol rejects Promise returns and pending jobs, but does not prove that no Promise was ever created or reject every use of async-related APIs; queued jobs are never executed.',
  },
  {
    id: 'positive-shared-module-state-distinct-calls', code: 'let count = 0; function target() { return ++count; }',
    calls: [[], []], expected: [value(1), value(2)], shouldPass: true,
  },
];
