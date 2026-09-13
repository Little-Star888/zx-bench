import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runIsolatedJsonSuite } from './isolatedJson.js';
import { ISOLATED_JSON_PILOTS } from '../evaluationLab/isolatedJsonGold.js';
import { codeRepairEvaluator } from '../evaluators/codeRepair.js';
import { runInContainer } from './containerRunner.js';
import { execAsync } from './execAsync.js';
import { runTestCaseInContainer, runReplacedCodeTestPythonInContainer } from '../sandbox/index.js';
import { runPhpTestsInContainer } from './phpRunner.js';
import { ISOLATED_PHP_JSON_PILOTS } from '../evaluationLab/isolatedPhpJsonGold.js';
const integration = process.env.ZXBENCH_CONTAINER_TESTS === '1' ? describe : describe.skip;
const bank=JSON.parse(readFileSync('data/scenarios/benchmark.json','utf8'));
integration('candidate-only container and host-owned oracle (local cached images only)',()=>{
  it('isolated PHP protocol: five golds pass while original and mutant controls fail',async()=>{
    for(const [id,fixture] of Object.entries(ISOLATED_PHP_JSON_PILOTS)){
      for(const [kind,code] of [['gold',fixture.correct],['original',bank.find((s:any)=>s.id===id).sourceCode],['mutant',fixture.mutant]]){
        const r=await runIsolatedJsonSuite(code,'php',fixture.contract);
        expect(r.infrastructureError,`${id}/${kind}`).toBeUndefined();
        if(kind==='gold')expect(r.passed,`${id}/${kind}`).toBe(r.total);
        else expect(r.passed,`${id}/${kind}`).toBeLessThan(r.total);
      }
      const dev=await runIsolatedJsonSuite(fixture.correct,'php',{...fixture.contract,cases:fixture.developmentCases!});
      expect(dev.infrastructureError,id).toBeUndefined();expect(dev.passed,id).toBe(dev.total);
    }
  },240_000);
  it('isolated PHP protocol: projection is fixed and candidate output cannot assert success',async()=>{
    const transformed=await runIsolatedJsonSuite('function answer($x){return [0=>"A",2=>"C"];}','php',{
      protocol:'isolated-php-json-v1',entrypoint:'answer',cases:[{id:'array-values',calls:[[0]],resultTransforms:['arrayValues'],expected:[['A','C']]}],
    });
    expect(transformed.infrastructureError).toBeUndefined();expect(transformed.passed).toBe(1);
    const expected=randomUUID();
    for(const code of [
      'function answer(){return 0;} echo json_encode(["passed"=>true,"score"=>100]); exit(0);',
      'function answer(){return implode("",array_map("file_get_contents",glob("/workspace/*")));}',
      'function answer(){file_put_contents("/workspace/driver.php","<?php echo 1;");return 0;}',
    ]){
      const r=await runIsolatedJsonSuite(code,'php',{protocol:'isolated-php-json-v1',entrypoint:'answer',cases:[{id:'oracle',calls:[[]],resultTransforms:['identity'],expected:[expected]}]});
      expect(r.infrastructureError).toBeUndefined();expect(r.passed).toBe(0);
    }
  },60_000);
  it('v3 evaluates numerical boundaries on the host for real Python and JavaScript outputs',async()=>{
    const c={protocol:'isolated-json-v3' as const,entrypoint:'answer',cases:[
      {id:'inside',calls:[[5e-10]],expected:[{all:[{path:[],approx:{value:0,absoluteTolerance:1e-9,inclusive:false}}]}]},
      {id:'boundary',calls:[[1e-9]],expected:[{all:[{path:[],approx:{value:0,absoluteTolerance:1e-9,inclusive:false}}]}]},
    ]};
    for(const [language,code] of [['python','def answer(x): return x'],['javascript','function answer(x){return x}']]){
      const r=await runIsolatedJsonSuite(code,language,c);
      expect(r.infrastructureError).toBeUndefined();expect(r.details.map(d=>d.passed)).toEqual([true,false]);
    }
  },60_000);
  it('v3 rejects nonfinite output and fake reports instead of accepting a numerical comparison bypass',async()=>{
    const c={protocol:'isolated-json-v3' as const,entrypoint:'answer',cases:[{id:'finite',calls:[[]],expected:[{all:[{path:[],approx:{value:0,absoluteTolerance:1e-9,inclusive:false}}]}]}]};
    for(const code of ['def answer(): return float("nan")','def answer(): return False',
      'def answer(): return {"equals":0}', 'def answer(): return 0\nimport sys\nsys.__stdout__.write(\'{"score":100}\')\nsys.exit(0)']){
      const r=await runIsolatedJsonSuite(code,'python',c);
      expect(r.infrastructureError).toBeUndefined();expect(r.passed).toBe(0);
    }
  },60_000);
  it('v2 retains keyword binding, zero, null, Unicode and multiple calls without coercion',async()=>{
    const contract={protocol:'isolated-json-v2' as const,entrypoint:'answer',cases:[{
      id:'keyword-binding',calls:[['u'],['u'],['u']],keywordArgs:[{timeout:0},{timeout:null},{timeout:'北京'}],expected:[0,null,'北京'],
    }]};
    const correct=await runIsolatedJsonSuite('def answer(url, *, timeout):\n    return timeout','python',contract);
    expect(correct.infrastructureError).toBeUndefined();expect(correct.passed).toBe(1);
    for(const code of ['def answer(url, timeout=30, /):\n    return timeout',
      'def answer(url, **kwargs):\n    return kwargs.get("timeout") or 30']) {
      const wrong=await runIsolatedJsonSuite(code,'python',contract);
      expect(wrong.infrastructureError).toBeUndefined();expect(wrong.passed).toBe(0);
    }
  },60_000);
  it('v2 duplicate binding fails instead of silently dropping the keyword',async()=>{
    const r=await runIsolatedJsonSuite('def answer(timeout):\n    return timeout','python',{
      protocol:'isolated-json-v2',entrypoint:'answer',cases:[{id:'duplicate',calls:[[1]],keywordArgs:[{timeout:2}],expected:[1]}],
    });
    expect(r.infrastructureError).toBeUndefined();expect(r.passed).toBe(0);expect(r.details[0].stderr).toContain('multiple values');
  },30_000);
  it('v2 exposes inputs but not host oracle, and rejects fake score reports',async()=>{
    const c={protocol:'isolated-json-v2' as const,entrypoint:'answer',cases:[{id:'hidden',calls:[[]],keywordArgs:[{timeout:0}],expected:[randomUUID()]}]};
    for(const code of ['def answer(**kw):\n    import pathlib\n    return "".join(p.read_text() for p in pathlib.Path("/workspace").iterdir() if p.is_file())',
      'def answer(**kw): return 0\nimport sys\nsys.__stdout__.write(\'{"passed":true,"score":100}\')\nsys.exit(0)']) {
      const r=await runIsolatedJsonSuite(code,'python',c);
      expect(r.infrastructureError).toBeUndefined();expect(r.passed).toBe(0);
    }
  },60_000);
  for(const [id,pilot] of Object.entries(ISOLATED_JSON_PILOTS)) it(`${id}: gold, original bug and semantic mutant`,async()=>{
    const scenario=bank.find((s:any)=>s.id===id);
    for(const [kind,code] of [['gold',pilot.correct],['original',scenario.sourceCode],['mutant',pilot.mutant]]) {
      const r=await codeRepairEvaluator.evaluate(scenario,'```\n'+code+'\n```',{} as any);
      expect(r.environmentError,r.evidence?.join('\n')).toBe(false);
      expect(r.runtimeEvaluation?.testsTotal).toBe(pilot.contract.cases.length);
      if(kind==='gold') expect(r.axisScores?.test_pass).toBe(100);
      else expect(r.axisScores?.test_pass).toBeLessThan(100);
      // Batch 2 promises preservation, not merely matching IDs. Run the original
      // assertions against the SAME repo-owned control and compare each verdict.
      // This legacy runner is diagnostic only; it never grants official scores.
      if (pilot.migrationBatch) {
        for (const test of scenario.hiddenTests) {
          const rawLegacy = pilot.language === 'python'
            ? await runReplacedCodeTestPythonInContainer(code, test)
            : pilot.language === 'php' ? await runPhpTestsInContainer(code,[test])
              : await runTestCaseInContainer(code, null, test);
          const legacy = pilot.language === 'php'
            ? {...rawLegacy,passed:(rawLegacy as Awaited<ReturnType<typeof runPhpTestsInContainer>>).tests[0]?.passed===true}
            : rawLegacy as typeof rawLegacy & {passed:boolean};
          expect(legacy.timedOut, `${id}/${kind}/${test.id} legacy timeout`).not.toBe(true);
          expect(legacy.exitCode, `${id}/${kind}/${test.id} backend unavailable`).not.toBe(-1);
          expect(r.runtimeEvaluation?.details.find(t => t.testId === test.id)?.passed,
            `${id}/${kind}/${test.id} migration changed test semantics`).toBe(legacy.passed);
        }
      }
      console.log(JSON.stringify({id,kind,passed:r.runtimeEvaluation?.testsPassed,total:r.runtimeEvaluation?.testsTotal}));
      if(pilot.developmentCases){
        const dev=await runIsolatedJsonSuite(code,pilot.language,{...pilot.contract,cases:pilot.developmentCases});
        expect(dev.infrastructureError).toBeUndefined();
        if(kind==='gold')expect(dev.passed).toBe(dev.total);
        console.log(JSON.stringify({id,kind,scope:'development-only',passed:dev.passed,total:dev.total}));
      }
    }
  },120_000);
  it('rejects early exit, readable-harness forgery, fake JSON reports and environment spoofing',async()=>{
    // Per-run secret cannot be memorized from public development fixtures. It is
    // NOT an input; no implementation can return it by reading its workspace.
    const contract={protocol:'isolated-json-v1' as const,entrypoint:'answer',cases:[{id:'host-only',calls:[[]],expected:[randomUUID()]}]};
    const attacks=[
      'function answer(){}; process.exit(0);',
      `import {readFileSync,readdirSync} from 'node:fs';
function answer() { const all=readdirSync('/workspace').map(f=>readFileSync('/workspace/'+f,'utf8')).join(''); return all.match(/ZXBENCH_TEST_COMPLETED_[0-9a-f-]{36}/)?.[0] ?? 'no-oracle'; }`,
      `function answer(){}; process.stdout.write('"PASS"'); process.exit(0);`,
      `function answer(){}; process.stdout.write('{"passed":true,"score":100}'); process.exit(0);`,
      `function answer(){}; console.error('Docker unavailable — container execution skipped'); process.exit(125);`,
      `import {writeFileSync} from 'node:fs'; function answer(){writeFileSync('/workspace/driver.mjs','process.exit(0)');return 'wrong';}`,
      `function answer(){JSON.stringify=()=> '"PASS"';return 'wrong';}`,
    ];
    for(let i=0;i<attacks.length;i++){
      const r=await runIsolatedJsonSuite(attacks[i],'javascript',contract);
      expect(r.infrastructureError).toBeUndefined();expect(r.passed,`attack ${i}`).toBe(0);
    }
  },120_000);
  it('normal logs are not verdicts; correct computation still passes in JS and Python',async()=>{
    const c={protocol:'isolated-json-v1' as const,entrypoint:'answer',cases:[{id:'a',calls:[[21]],expected:[42]}]};
    for(const [lang,code] of [['javascript',"function answer(x){console.log('debug');return x*2}"],['python',"def answer(x):\n    print('debug')\n    return x*2"]]){
      const r=await runIsolatedJsonSuite(code,lang,c);expect(r.infrastructureError).toBeUndefined();expect(r.passed).toBe(1);
    }
  },60_000);
  it('Python cannot forge a verdict by reading its own source or exiting normally',async()=>{
    const c={protocol:'isolated-json-v1' as const,entrypoint:'answer',cases:[{id:'a',calls:[[]],expected:[42]}]};
    for(const code of ['def answer(): return 0\nimport os\nos._exit(0)',
      'def answer(): return 0\nimport sys\nsys.__stdout__.write(\'{"passed":true}\')\nsys.exit(0)']){
      const r=await runIsolatedJsonSuite(code,'python',c);expect(r.infrastructureError).toBeUndefined();expect(r.passed).toBe(0);
    }
  },60_000);
  it('limits runaway output and time',async()=>{
    const c={protocol:'isolated-json-v1' as const,entrypoint:'answer',cases:[{id:'a',calls:[[]],expected:[42]}]};
    const flood=await runIsolatedJsonSuite('function answer(){process.stdout.write("x".repeat(200000));return 42}','javascript',c);
    expect(flood.infrastructureError).toBeUndefined();expect(flood.passed).toBe(0);
    const spin=await runIsolatedJsonSuite('function answer(){while(true){}}','javascript',c);
    expect(spin.infrastructureError).toBeUndefined();expect(spin.passed).toBe(0);expect(spin.details[0].timedOut).toBe(true);
  },45_000);
  it('enforces read-only root/source and destroys timed-out containers by exact name',async()=>{
    const options={image:'node:20-alpine',localImageOnly:true,readOnlyRoot:true,timeoutMs:1000};
    const policies=await runInContainer({...options,command:['node','-e',`
      const fs=require('fs'),os=require('os');
      if(process.getuid()===0)process.exit(1);
      if(Object.keys(os.networkInterfaces()).some(n=>n!=='lo'))process.exit(2);
      for(const path of ['/workspace/forbidden','/etc/forbidden']){
        let blocked=false;try{fs.writeFileSync(path,'x')}catch{blocked=true}
        if(!blocked)process.exit(3);
      }
      fs.writeFileSync('/tmp/allowed','x');
    `]});
    expect(policies.success,policies.stderr).toBe(true);
    const timed=await runInContainer({...options,command:['node','-e','while(true){}']});
    expect(timed.timedOut).toBe(true);expect(timed.containerName).toMatch(/^zxbench-/);
    const after=await execAsync('docker',['inspect',timed.containerName!],{timeout:5000});
    expect(after.status).not.toBe(0);
  },30_000);
  it('does not share writable state between cases',async()=>{
    const r=await runIsolatedJsonSuite(`import {existsSync,writeFileSync} from 'node:fs';
function answer(){const stale=existsSync('/tmp/state');writeFileSync('/tmp/state','x');return !stale;}`,'javascript',
      {protocol:'isolated-json-v1',entrypoint:'answer',cases:[{id:'first',calls:[[]],expected:[true]},{id:'second',calls:[[]],expected:[true]}]});
    expect(r.infrastructureError).toBeUndefined();expect(r.passed).toBe(2);
  },30_000);
});
