/** Black-box JSON observations: candidate code never receives assertions,
 * expected values, other cases, or the host's verdict channel. stdout is DATA,
 * not a trusted report. This certifies output behavior only, not internal calls,
 * identity, complexity, side effects or general sandbox/VM escape resistance. */
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';
import type { TestDetail } from '@zxbench/types';
import { runInContainer, CONTAINER_IMAGES, type ContainerRunOptions } from './containerRunner.js';
import { validJsonValuePredicate, matchesJsonValuePredicate } from './jsonValuePredicate.js';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface IsolatedJsonCase {
  id: string;
  calls: JsonValue[][];
  /** v2 only: one keyword dictionary per call; Python only. */
  keywordArgs?: Record<string, JsonValue>[];
  /** isolated-php-json-v1 only: fixed built-in projection per call. */
  resultTransforms?: ('identity' | 'arrayValues')[];
  expected: JsonValue[];
}
export interface IsolatedJsonContract {
  /** v3 expected entries are JsonValuePredicate objects, not literal outputs. */
  protocol: 'isolated-json-v1' | 'isolated-json-v2' | 'isolated-json-v3' | 'isolated-php-json-v1';
  entrypoint: string;
  cases: IsolatedJsonCase[];
}
function isJson(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
  if (Array.isArray(value)) return value.every(v => isJson(v, depth + 1));
  return typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Object.values(value as object).every(v => isJson(v, depth + 1));
}
export function validIsolatedJsonContract(value: unknown): value is IsolatedJsonContract {
  if (!value || typeof value !== 'object') return false;
  const c = value as IsolatedJsonContract;
  return ['isolated-json-v1', 'isolated-json-v2', 'isolated-json-v3', 'isolated-php-json-v1'].includes(c.protocol) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(c.entrypoint)
    && Array.isArray(c.cases) && c.cases.length > 0 && c.cases.length <= 100
    && new Set(c.cases.map(t => t?.id)).size === c.cases.length
    && c.cases.every(t => t && typeof t.id === 'string' && t.id.length > 0
      && Array.isArray(t.calls) && t.calls.length > 0 && t.calls.length <= 100
      && t.calls.every(args => Array.isArray(args) && isJson(args))
      && (c.protocol !== 'isolated-json-v2' ? t.keywordArgs === undefined
        : Array.isArray(t.keywordArgs) && t.keywordArgs.length === t.calls.length
          && t.keywordArgs.every(kw => kw !== null && typeof kw === 'object' && !Array.isArray(kw)
            && isJson(kw) && Object.keys(kw).every(k => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k))))
      && (c.protocol === 'isolated-php-json-v1'
        ? Array.isArray(t.resultTransforms) && t.resultTransforms.length === t.calls.length
          && t.resultTransforms.every(transform => ['identity','arrayValues'].includes(transform))
        : t.resultTransforms === undefined)
      && Array.isArray(t.expected) && t.expected.length === t.calls.length && isJson(t.expected)
      && (c.protocol !== 'isolated-json-v3' || t.expected.every(validJsonValuePredicate)));
}

/** Never search for a PASS marker, extract JSON from prose, accept extra fields,
 * coerce types, or trust an assertion count. Limit/depth guards precede equality. */
export function compareJsonObservation(stdout: string, expected: JsonValue[], protocol: IsolatedJsonContract['protocol'] = 'isolated-json-v1'): boolean {
  if (Buffer.byteLength(stdout) > 64 * 1024) return false;
  try {
    const value: unknown = JSON.parse(stdout);
    if (!['isolated-json-v1','isolated-json-v2','isolated-json-v3','isolated-php-json-v1'].includes(protocol)
      || !Array.isArray(value) || !isJson(value) || !isJson(expected) || value.length !== expected.length) return false;
    return protocol === 'isolated-json-v3'
      ? expected.every((predicate, i) => validJsonValuePredicate(predicate) && matchesJsonValuePredicate(value[i], predicate))
      : isDeepStrictEqual(value, expected);
  } catch { return false; }
}

const jsDriver = `import {readFileSync} from 'node:fs';
const write = process.stdout.write.bind(process.stdout);
const serialize = JSON.stringify;
const request = JSON.parse(readFileSync('/workspace/input.json','utf8'));
console.log = console.info = console.warn = console.error.bind(console);
const {zxEntry} = await import('./candidate.mjs');
const output = [];
for (const args of request.calls) output.push(await zxEntry(...args));
write(serialize(output, (_key, value) => {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol'
      || (typeof value === 'number' && !Number.isFinite(value))) throw Error('NON_JSON_RESULT');
  return value;
}));
`;
const pyDriver = `import json, sys, importlib.util, contextlib
write = sys.stdout.write
serialize = json.dumps
with open('/workspace/input.json') as f:
    request = json.load(f)
spec = importlib.util.spec_from_file_location('candidate', '/workspace/candidate.py')
module = importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(sys.stderr):
    spec.loader.exec_module(module)
    entry = getattr(module, request['entrypoint'])
    if request.get('protocol') == 'isolated-json-v2':
        output = [entry(*args, **kwargs) for args, kwargs in zip(request['calls'], request['keywordArgs'], strict=True)]
    else:
        output = [entry(*args) for args in request['calls']]
write(serialize(output, ensure_ascii=False, allow_nan=False))
`;
const phpDriver = `<?php
$request = json_decode(file_get_contents('/workspace/input.json'), true, 512, JSON_THROW_ON_ERROR);
ob_start();
require '/workspace/candidate.php';
$entry = $request['entrypoint'];
$output = [];
foreach ($request['calls'] as $index => $args) {
    $value = $entry(...$args);
    if ($request['resultTransforms'][$index] === 'arrayValues') $value = array_values($value);
    $output[] = $value;
}
ob_end_clean();
echo json_encode($output, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION | JSON_UNESCAPED_UNICODE);
`;

export const PHP_JSON_IMAGE='php@sha256:6d3dcc922fa36d06d6eefba5697a0aee599cf2f306b3cc2700a6526bc8fd5c09';
export function jsonProtocolSupportsLanguage(protocol:IsolatedJsonContract['protocol'],language:string):boolean {
  if(protocol==='isolated-json-v2')return language==='python';
  if(protocol==='isolated-php-json-v1')return language==='php';
  return ['javascript','typescript','python'].includes(language);
}

/** Only the explicit whitelist below is materialized, NEVER {...case} or the
 * full Scenario/requirements. Even IDs/expected outputs stay outside Docker. */
export function isolatedCandidateOptions(code: string, language: string, entrypoint: string,
  calls: JsonValue[][], timeoutMs = 3000, protocol: IsolatedJsonContract['protocol'] = 'isolated-json-v1',
  keywordArgs?: Record<string, JsonValue>[], resultTransforms?: ('identity' | 'arrayValues')[]): ContainerRunOptions {
  if (!validIsolatedJsonContract({ protocol, entrypoint, cases: [{ id: 'input', calls, keywordArgs, resultTransforms, expected: calls.map(() => protocol === 'isolated-json-v3' ? {equals:null} : null) }] })
      || !jsonProtocolSupportsLanguage(protocol,language)) throw Error('Invalid isolated call protocol/language');
  if (!['javascript', 'typescript', 'python', 'php'].includes(language)
      || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entrypoint)) throw Error('Unsupported isolated observation interface');
  const python = language === 'python';
  const php = language === 'php';
  const source = language === 'typescript'
    ? ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
    : code;
  return {
    image: php ? PHP_JSON_IMAGE : python ? CONTAINER_IMAGES.python : CONTAINER_IMAGES.javascript,
    command: php ? ['php', '-d', 'display_errors=stderr', 'driver.php'] : python ? ['python', '-B', 'driver.py'] : ['node', 'driver.mjs'],
    files: [
      { path: php ? 'candidate.php' : python ? 'candidate.py' : 'candidate.mjs', content: php ? '<?php\n'+source.trim().replace(/^<\?php\s*/, '').replace(/\?>\s*$/, '') : python ? source : source + `\nexport { ${entrypoint} as zxEntry };\n` },
      { path: php ? 'driver.php' : python ? 'driver.py' : 'driver.mjs', content: php ? phpDriver : python ? pyDriver : jsDriver },
      { path: 'input.json', content: JSON.stringify(protocol === 'isolated-json-v2'
        ? { protocol, entrypoint, calls, keywordArgs } : protocol === 'isolated-php-json-v1'
          ? { entrypoint, calls, resultTransforms } : { entrypoint, calls }) },
    ],
    localImageOnly: true, readOnlyRoot: true, readOnly: true, networkDisabled: true,
    runAsNonRoot: true, memoryMb: 128, cpuLimit: 1, pidsLimit: 32,
    timeoutMs, maxOutputBytes: 64 * 1024, env: { HOME: '/tmp' },
  };
}

export async function runIsolatedJsonSuite(code: string, language: string, contract: IsolatedJsonContract) {
  if (!validIsolatedJsonContract(contract)) throw Error('Invalid isolated observation contract');
  const options = (c: IsolatedJsonCase) => isolatedCandidateOptions(code, language, contract.entrypoint, c.calls, 3000, contract.protocol, c.keywordArgs, c.resultTransforms);
  const base = options(contract.cases[0]);
  // Parser/compiler runs without importing/evaluating candidate code.
  const syntax = await runInContainer({ ...base,
    files: base.files!.filter(f => f.path.startsWith('candidate.')),
    command: language === 'python'
      ? ['python', '-c', "import ast; ast.parse(open('candidate.py').read())"]
      : language === 'php' ? ['php', '-l', 'candidate.php']
      : ['node', '--check', 'candidate.mjs'],
  });
  let infrastructureError = syntax.infrastructureError;
  const details: TestDetail[] = [];
  for (const c of contract.cases) {
    if (infrastructureError) break; // no time wasted on a missing backend
    const startedAt = new Date().toISOString();
    const r = syntax.success
      ? await runInContainer(options(c))
      : syntax;
    infrastructureError = r.infrastructureError;
    const passed = r.success && !r.timedOut && !r.infrastructureError && !r.outputLimitExceeded && compareJsonObservation(r.stdout, c.expected, contract.protocol);
    details.push({ testId: c.id, testType: 'hidden', passed,
      stdout: r.stdout, stderr: r.stderr, actualOutput: r.stdout, exitCode: r.exitCode,
      timedOut: r.timedOut, duration: r.durationMs, startedAt, finishedAt: new Date().toISOString(),
    });
  }
  return { compiled: syntax.success, compileError: syntax.success ? undefined : syntax.stderr,
    infrastructureError, details, total: contract.cases.length,
    passed: details.filter(t => t.passed).length };
}
