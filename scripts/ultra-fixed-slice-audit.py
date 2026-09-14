"""A bounded independent counting cross-check before accepting the hard answer key.
Fixes one rank-two matrix; does not use the subspace-enumeration algorithm.
"""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
base=ROOT/'reports/ultra-rank-authoring-20260914'
key=json.loads((base/'answer-key.json').read_text())
def rr(m):return [(m>>s)&7 for s in [0,3,6]]
def cc(m):return [sum(((m>>(3*i+j))&1)<<i for i in range(3)) for j in range(3)]
def rk(a):
    a=a[:];r=0
    for bit in [4,2,1]:
        k=next((k for k in range(r,len(a)) if a[k]&bit),None)
        if k is not None:
            a[r],a[k]=a[k],a[r]
            for i in range(r+1,len(a)):
                if a[i]&bit:a[i]^=a[r]
            r+=1
    return r
def mm(a,b):return sum(((rr(a)[i]&cc(b)[j]).bit_count()%2)<<(3*i+j) for i in range(3) for j in range(3))
rank=[rk(rr(m)) for m in range(512)];r2=[m for m in range(512) if rank[m]==2];gl=[m for m in range(512) if rank[m]==3]
a=10;stab=[(p,q) for p in gl for q in gl if mm(mm(p,a),q)==a]
remaining={b for b in r2 if rank[a^b]==2};table=[];pairs=0
while remaining:
    b=min(remaining);bo={mm(mm(p,b),q) for p,q in stab};remaining-=bo
    cs=[c for c in r2 if all(rank[z]==2 for z in [a^c,b^c,a^b^c]) and rk(rr(a)+rr(b)+rr(c))==3 and rk(cc(a)+cc(b)+cc(c))==3]
    pairs+=len(bo)*len(cs)
    table.append({'B':b,'BOrbitSize':len(bo),'eligibleC':len(cs),'pairCount':len(bo)*len(cs)})
assert pairs*len(r2)==key['field2']['orderedQuotientTriples']
assert len(stab)==96
result={'fixedA':a,'fixedAStabilizerOrder':len(stab),'eligibleOrderedPairsBC':pairs,'sliceTable':table,
        'total':pairs*len(r2),'matchesSubspaceOracle':True,'modelCalls':0}
(base/'fixed-slice-audit.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))
