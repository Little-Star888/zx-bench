/** Experimental NEGATIVE controls. These deliberately untrusted drivers are
 * never registered as scorers. Moving a comparison outside the candidate does
 * not authenticate candidate-reported exceptions, aliases, or argument state. */
import { isDeepStrictEqual } from 'node:util';
import { runInContainer } from '../execution/containerRunner.js';

export const OBSERVATION_TRUST_CONTROLS = [
  {
    id: 'js-exception-forgery', language: 'javascript', expected: { kind: 'throw', name: 'RangeError' },
    driver: `import {target} from './candidate.mjs';
let record; try { record={kind:'return',value:target(0)}; }
catch(e) { record={kind:'throw',name:e.name}; }
process.stdout.write(JSON.stringify(record));`,
    correct: 'export function target(n){throw new RangeError("invalid");}',
    incorrect: 'export function target(n){return 0;}',
    forged: `export function target(n){process.stdout.write('{"kind":"throw","name":"RangeError"}');process.exit(0);}`,
    violation: 'Candidate exits without throwing; stdout falsely describes a RangeError.',
  },
  {
    id: 'js-argument-state-forgery', language: 'javascript', expected: { value: 2, args: [[1, 2]] },
    driver: `import {target} from './candidate.mjs';
const args=[[1,2]];const value=target(...args);
process.stdout.write(JSON.stringify({value,args}));`,
    correct: 'export function target(a){return a.length;}',
    incorrect: 'export function target(a){const n=a.length;a.length=0;return n;}',
    forged: `export function target(a){const original=[...a];a.length=0;
process.stdout.write(JSON.stringify({value:original.length,args:[original]}));process.exit(0);}`,
    violation: 'Candidate destroys the input then claims its saved pre-call copy is post-call state.',
  },
  {
    id: 'py-exception-forgery', language: 'python', expected: { kind: 'throw', name: 'ValueError' },
    driver: `import json
from candidate import target
try:
    record={'kind':'return','value':target(0)}
except Exception as e:
    record={'kind':'throw','name':type(e).__name__}
print(json.dumps(record))`,
    correct: 'def target(n):\n    raise ValueError("invalid")',
    incorrect: 'def target(n):\n    return 0',
    forged: `def target(n):
    import sys
    sys.stdout.write('{"kind":"throw","name":"ValueError"}')
    sys.exit(0)`,
    violation: 'SystemExit bypasses the exception observer and emits a false ValueError record.',
  },
  {
    id: 'py-object-identity-forgery', language: 'python', expected: { same: true },
    driver: `import json
from candidate import target
a=[1,2];b=target(a)
print(json.dumps({'same': b is a}))`,
    correct: 'def target(a):\n    return a',
    incorrect: 'def target(a):\n    return list(a)',
    forged: `def target(a):
    import sys
    sys.stdout.write('{"same":true}')
    sys.exit(0)`,
    violation: 'No object is returned; the identity predicate is replaced by a candidate-authored boolean.',
  },
];

export async function probeObservationTrust() {
  const results = [];
  for (const c of OBSERVATION_TRUST_CONTROLS) {
    const controls: { kind: string; accepted: boolean; infrastructureError?: string; timedOut: boolean }[] = [];
    for (const kind of ['correct', 'incorrect', 'forged'] as const) {
      const python = c.language === 'python';
      const r = await runInContainer({image:python?'python:3.12-alpine':'node:20-alpine',
        command:python?['python','-B','driver.py']:['node','driver.mjs'],
        files:[{path:python?'candidate.py':'candidate.mjs',content:c[kind]},
          {path:python?'driver.py':'driver.mjs',content:c.driver}],
        localImageOnly:true,readOnlyRoot:true,networkDisabled:true,readOnly:true,runAsNonRoot:true,
        timeoutMs:3000,maxOutputBytes:65536,memoryMb:128,pidsLimit:32});
      let accepted = false;
      try { accepted = r.success && isDeepStrictEqual(JSON.parse(r.stdout), c.expected); } catch { /* invalid data */ }
      controls.push({kind,accepted,infrastructureError:r.infrastructureError,timedOut:r.timedOut});
    }
    const controlsValid = controls.every(r=>!r.infrastructureError&&!r.timedOut)
      && controls[0].accepted && !controls[1].accepted;
    results.push({id:c.id,violation:c.violation,controls,controlsValid,
      status:!controlsValid?'invalid_probe':controls[2].accepted?'self_report_forgery_reproduced':'attack_rejected'});
  }
  return {version:'observation-trust-negative-controls-v1',scope:'experimental_driver_only',
    modelApiCalls:0,formalQuestionsMigrated:0,results,
    safeToEnableSemanticObservations:false,releaseReady:false};
}
