import { expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { compareJsonObservation, isolatedCandidateOptions, runIsolatedJsonSuite, validIsolatedJsonContract } from './isolatedJson.js';
import { runInContainer } from './containerRunner.js';
import { ISOLATED_JSON_PILOTS } from '../evaluationLab/isolatedJsonGold.js';
import { QUICKJS_OBSERVATION_PILOTS } from '../evaluationLab/quickJsObservationGold.js';
import { ISOLATED_JAVA_JSON_PILOTS } from '../evaluationLab/isolatedJavaJsonGold.js';
import { ISOLATED_CSHARP_JSON_PILOTS } from '../evaluationLab/isolatedCsharpJsonGold.js';
import { ISOLATED_GO_JSON_PILOTS } from '../evaluationLab/isolatedGoJsonGold.js';
import { ISOLATED_PHP_JSON_V2_PILOTS } from '../evaluationLab/isolatedPhpJsonV2Gold.js';
import { ISOLATED_PYTHON_JSON_PILOTS } from '../evaluationLab/isolatedPythonJsonGold.js';
import { ISOLATED_JAVASCRIPT_JSON_PILOTS } from '../evaluationLab/isolatedJavascriptJsonGold.js';
import { ISOLATED_SQL_JSON_PILOTS } from '../evaluationLab/isolatedSqlJsonGold.js';
import { ISOLATED_TYPESCRIPT_JSON_PILOTS } from '../evaluationLab/isolatedTypescriptJsonGold.js';
import { ISOLATED_TYPESCRIPT_TYPE_PILOTS } from '../evaluationLab/isolatedTypescriptTypeGold.js';
import { ISOLATED_FIXTURE_EXIT_PILOTS } from '../evaluationLab/isolatedFixtureExitGold.js';
import { codeRepairEvaluator } from '../evaluators/codeRepair.js';
vi.mock('./containerRunner.js', async original => ({ ...await original<object>(), runInContainer: vi.fn() }));
const contract = { protocol: 'isolated-json-v1' as const, entrypoint: 'answer', cases: [{id:'secret-id',calls:[[]],expected:['SECRET_EXPECTED']}] };
const ok = { success:true,stdout:'["SECRET_EXPECTED"]',stderr:'',exitCode:0,timedOut:false,durationMs:1 };
beforeEach(() => vi.mocked(runInContainer).mockReset());

it('validates nonempty, finite, unique and complete contracts', () => {
  expect(validIsolatedJsonContract(contract)).toBe(true);
  for (const c of [{...contract,entrypoint:'answer();evil()'}, {...contract,cases:[]},
    {...contract,cases:[...contract.cases,...contract.cases]},
    {...contract,cases:[{id:'a',calls:[[]],expected:[]}]},
    {...contract,cases:[{id:'a',calls:[[NaN]],expected:[1]}]}]) expect(validIsolatedJsonContract(c)).toBe(false);
});
it('v2 keyword dictionaries are complete, finite and unavailable to v1', () => {
  const c = ISOLATED_JSON_PILOTS['CP-L2-PY-001'].contract;
  expect(validIsolatedJsonContract(c)).toBe(true);
  expect(validIsolatedJsonContract({...c, protocol:'isolated-json-v1'})).toBe(false);
  for (const keywordArgs of [undefined, [], [null], [[]], [{timeout:NaN}], [{'a-b':1}], [{timeout:0}, {}]]) {
    expect(validIsolatedJsonContract({...c,cases:[{...c.cases[0],keywordArgs}]})).toBe(false);
  }
});
it('v2 transmits keywords as data, without test IDs, expected values or executable snippets', () => {
  const c={...contract.cases[0],keywordArgs:[{timeout:0}]};
  const options=isolatedCandidateOptions('def answer(*a, **kw): return 0','python','answer',c.calls,3000,'isolated-json-v2',c.keywordArgs);
  expect(JSON.parse(options.files!.find(f=>f.path==='input.json')!.content)).toEqual({protocol:'isolated-json-v2',entrypoint:'answer',calls:[[]],keywordArgs:[{timeout:0}]});
  for(const secret of ['SECRET_EXPECTED','secret-id','expected']) expect(JSON.stringify(options)).not.toContain(secret);
  expect(()=>isolatedCandidateOptions('','javascript','answer',[[]],3000,'isolated-json-v2',[{}])).toThrow();
  expect(()=>isolatedCandidateOptions('','python','answer',[[]],3000,'isolated-json-v1',[{}])).toThrow();
});
it('rejects non-Python v2 before executing candidate code',async()=>{
  const fixture=ISOLATED_JSON_PILOTS['CP-L2-PY-001'];
  const s={id:'wrong-language',language:'javascript',functionName:'request',requirements:{isolatedJson:fixture.contract},hiddenTests:fixture.contract.cases.map(c=>({id:c.id}))} as any;
  const result=await codeRepairEvaluator.evaluate(s,'```js\nfunction request(){}\n```',{} as any);
  expect(result.environmentError).toBe(true);expect(runInContainer).not.toHaveBeenCalled();
});
it.each([{timedOut:true},{infrastructureError:'host failure'}])('matching output cannot override independent runtime failure %j',async failure=>{
  vi.mocked(runInContainer).mockResolvedValueOnce(ok).mockResolvedValue({...ok,...failure});
  expect((await runIsolatedJsonSuite('','python',contract)).passed).toBe(0);
});
it.each(['PASS', '{"passed":true,"score":100}', '["SECRET_EXPECTED"]\nPASS',
  '```json\n["SECRET_EXPECTED"]\n```', '["wrong"]', '{"0":"SECRET_EXPECTED"}', '[]'])('rejects forged/malformed reports: %s', output => {
  expect(compareJsonObservation(output, contract.cases[0].expected)).toBe(false);
});
it('compares exact JSON types, lengths and object fields', () => {
  expect(compareJsonObservation('[42]',[42])).toBe(true);
  for (const output of ['["42"]','[true]','[null]','[42,42]']) expect(compareJsonObservation(output,[42])).toBe(false);
  expect(compareJsonObservation('[{"x":1,"score":100}]',[{x:1}])).toBe(false);
  expect(compareJsonObservation('[{"b":2,"a":1}]',[{a:1,b:2}])).toBe(true);
});
it('mounts only candidate, transport and current inputs; hardens container options', () => {
  const o=isolatedCandidateOptions('function answer(){return 0}', 'javascript',contract.entrypoint,contract.cases[0].calls);
  const serialized=JSON.stringify(o);
  for(const secret of ['SECRET_EXPECTED','secret-id','expected','assert(']) expect(serialized).not.toContain(secret);
  expect(o.files?.map(f=>f.path)).toEqual(['candidate.mjs','driver.mjs','input.json']);
  expect(o).toMatchObject({localImageOnly:true,readOnlyRoot:true,networkDisabled:true,readOnly:true,runAsNonRoot:true,maxOutputBytes:65536});
});
it('ignores candidate infrastructure claims; does not discard their failed result', async () => {
  vi.mocked(runInContainer).mockResolvedValueOnce(ok).mockResolvedValue({...ok,stdout:'[]',stderr:'Docker unavailable — container execution skipped'});
  const r=await runIsolatedJsonSuite('function answer(){}','javascript',contract);
  expect(r.infrastructureError).toBeUndefined(); expect(r.passed).toBe(0); expect(r.total).toBe(1);
});
it('requires exit success and no timeout/overflow even when output matches', async () => {
  for(const failure of [{success:false,exitCode:1},{success:false,timedOut:true},{outputLimitExceeded:true}]) {
    vi.mocked(runInContainer).mockReset().mockResolvedValueOnce(ok).mockResolvedValue({...ok,...failure});
    expect((await runIsolatedJsonSuite('function answer(){}','javascript',contract)).passed).toBe(0);
  }
});
it('stops at independently observed infrastructure failure',async()=>{
  vi.mocked(runInContainer).mockResolvedValue({...ok,success:false,infrastructureError:'Missing image'});
  const r=await runIsolatedJsonSuite('','javascript',contract);
  expect(r.infrastructureError).toBe('Missing image');expect(runInContainer).toHaveBeenCalledTimes(1);
});
it('production cannot use the legacy scorer or trusted-host switch as an isolation bypass',async()=>{
  const s={id:'unmigrated',language:'javascript',functionName:'answer',requirements:{},hiddenTests:[]} as any;
  const r=await codeRepairEvaluator.evaluate(s,'```js\nprocess.exit(0);\n```',{} as any);
  expect(r.environmentError).toBe(true);expect(r.axisCoverage).toBe(0);expect(r.axisScores).toBeUndefined();
  expect(runInContainer).not.toHaveBeenCalled();
});
it('preserves every original test ID for all migrated questions and reconciles coverage',()=>{
  const bank=JSON.parse(readFileSync('data/scenarios/benchmark.json','utf8'));
  for(const [id,p] of Object.entries(ISOLATED_JSON_PILOTS)) {
    const s=bank.find((s:any)=>s.id===id);
    expect(s.requirements.isolatedJson).toEqual(p.contract);
    expect(s.hiddenTests.map((t:any)=>t.id)).toEqual(p.contract.cases.map(c=>c.id));
  }
  const meta=JSON.parse(readFileSync('data/scenarios/benchmark-meta.json','utf8'));
  expect(meta.executionIsolation.pilots).toEqual([...Object.keys(ISOLATED_JSON_PILOTS),...Object.keys(ISOLATED_JAVA_JSON_PILOTS),...Object.keys(ISOLATED_CSHARP_JSON_PILOTS),...Object.keys(ISOLATED_GO_JSON_PILOTS),...Object.keys(ISOLATED_PHP_JSON_V2_PILOTS),...Object.keys(ISOLATED_PYTHON_JSON_PILOTS),...Object.keys(ISOLATED_JAVASCRIPT_JSON_PILOTS),...Object.keys(ISOLATED_SQL_JSON_PILOTS),...Object.keys(ISOLATED_TYPESCRIPT_JSON_PILOTS),...Object.keys(ISOLATED_TYPESCRIPT_TYPE_PILOTS),...Object.keys(ISOLATED_FIXTURE_EXIT_PILOTS),...Object.keys(QUICKJS_OBSERVATION_PILOTS)]);
  expect(meta.executionIsolation.pendingCodeRepair).toBe(bank.filter((s:any)=>s.grader==='code_repair'
    &&s.expectedVerdict!=='no_bug'&&!s.requirements?.isolatedJson&&!s.requirements?.isolatedJavaJson&&!s.requirements?.isolatedCsharpJson&&!s.requirements?.isolatedGoJson&&!s.requirements?.isolatedPhpJson&&!s.requirements?.isolatedPythonJson&&!s.requirements?.isolatedJavascriptJson&&!s.requirements?.isolatedSqlJson&&!s.requirements?.isolatedTypescriptJson&&!s.requirements?.isolatedTypescriptType&&!s.requirements?.isolatedFixtureExit&&!s.requirements?.quickJsObservation).length);
  expect(meta.executionIsolation.fullAcceptance).toBe(false);
});
it('does not silently replace identity, mutation, performance or type checks with return values',()=>{
  const bank=JSON.parse(readFileSync('data/scenarios/benchmark.json','utf8'));
  for(const id of ['CP-L1-PY-001','CP-L3-PY-012','CP-L2-JS-004','CP-L3-PERF-PY-001','CP-L3-TS-006']) {
    expect(bank.find((s:any)=>s.id===id).requirements.isolatedJson,id).toBeUndefined();
  }
});
it('retains both assertions of the compound Roman subtraction test',()=>{
  const c=ISOLATED_JSON_PILOTS['CP-L2-TD-PY-003'].contract.cases[1];
  expect(c.calls).toEqual([['IV'],['IX']]);expect(c.expected).toEqual([4,9]);
  expect(compareJsonObservation('[4]',c.expected)).toBe(false);
  expect(compareJsonObservation('[4,11]',c.expected)).toBe(false);
});
