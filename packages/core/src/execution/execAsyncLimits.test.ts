import { it, expect } from 'vitest';
import { execAsync } from './execAsync.js';
it('preserves UTF-8 characters split across pipe chunks',async()=>{
  const r=await execAsync(process.execPath,['-e',"const b=Buffer.from('北京');process.stdout.write(b.subarray(0,1));setTimeout(()=>process.stdout.write(b.subarray(1)),50);"],{timeout:3000});
  expect(r.stdout).toBe('北京');expect(r.status).toBe(0);
});
it('bounds combined output by bytes and treats overflow as failure even after printing a valid result',async()=>{
  const r=await execAsync(process.execPath,['-e',"process.stdout.write('[42]');process.stderr.write('字'.repeat(20000));"],{maxBuffer:1000,timeout:3000});
  expect(r.error?.code).toBe('ENOBUFS');
  // A partial UTF-8 codepoint may be replaced by up to two extra bytes.
  expect(Buffer.byteLength(r.stdout+r.stderr)).toBeLessThanOrEqual(1002);
});
