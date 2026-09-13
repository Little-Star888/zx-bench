import { expect, it, vi } from 'vitest';
import { OBSERVATION_TRUST_CONTROLS, probeObservationTrust } from './observationTrust.js';
import { runInContainer } from '../execution/containerRunner.js';
vi.mock('../execution/containerRunner.js',()=>({runInContainer:vi.fn()}));
it('treats a forged metadata match as a vulnerability, not semantic acceptance',async()=>{
  vi.mocked(runInContainer).mockImplementation(async o=>{
    const c=OBSERVATION_TRUST_CONTROLS.find(c=>c.driver===o.files?.[1].content)!;
    return {success:true,stdout:JSON.stringify(o.files?.[0].content===c.incorrect?{wrong:true}:c.expected),stderr:'',exitCode:0,timedOut:false,durationMs:1};
  });
  const r=await probeObservationTrust();
  expect(r.results.every(c=>c.controlsValid&&c.status==='self_report_forgery_reproduced')).toBe(true);
  expect(r.safeToEnableSemanticObservations).toBe(false);expect(r.formalQuestionsMigrated).toBe(0);
});
it('does not infer a trust vulnerability when the environment controls failed',async()=>{
  vi.mocked(runInContainer).mockResolvedValue({success:false,stdout:'',stderr:'unavailable',infrastructureError:'Docker unavailable',exitCode:-1,timedOut:false,durationMs:0});
  expect((await probeObservationTrust()).results.every(c=>!c.controlsValid&&c.status==='invalid_probe')).toBe(true);
});
