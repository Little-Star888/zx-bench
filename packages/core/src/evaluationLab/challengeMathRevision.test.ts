import {describe,expect,it} from 'vitest';
import {buildMc2004Revision,gradeMc2004Revision,mc2004RevisionReference} from './challengeMathRevision.js';

describe('MC2-004-R1 bounded redesign',()=>{
  it('has a stable non-trivial exact reference',()=>{
    const reference=mc2004RevisionReference();
    expect(reference.total).toBeGreaterThan(0);
    expect(reference.by_first.reduce((a,b)=>a+b,0)).toBe(reference.total);
    expect(reference.residue_histogram).toHaveLength(5);
    expect(new Set(reference.residue_histogram).size).toBeGreaterThan(1);
  });
  it('accepts only the complete certificate',()=>{
    const reference=buildMc2004Revision().reference;
    expect(gradeMc2004Revision(reference).strictPass).toBe(true);
    expect(gradeMc2004Revision({...reference,total:Number(reference.total)+1}).strictPass).toBe(false);
    expect(gradeMc2004Revision({total:reference.total,by_first:reference.by_first}).formatValid).toBe(false);
  });
});
