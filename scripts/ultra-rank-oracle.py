"""Exact authoring oracle for a fixed binary rank problem; no model calls.

Matrices are 3 by 3 over F2, packed row-major into 9 bits (low row first).
Enumerates subspaces, not 6 by 6 operator triples. Never executes model code.
"""
import json
from pathlib import Path
from itertools import permutations

ROOT=Path(__file__).resolve().parents[1]
def rank(rows):
    basis=[]
    for v in rows:
        for b in basis: v=min(v,v^b)
        if v: basis.append(v);basis.sort(reverse=True)
    return len(basis)
def rows(m):return [(m>>(3*i))&7 for i in range(3)]
def cols(m):return [sum(((m>>(3*i+j))&1)<<i for i in range(3)) for j in range(3)]
def mul(a,b):
    ar,bc=rows(a),cols(b)
    return sum(((ar[i]&bc[j]).bit_count()%2)<<(3*i+j) for i in range(3) for j in range(3))
def span(t):
    a,b,c=t
    return [a,b,c,a^b,a^c,b^c,a^b^c]
def canonical(s):
    a=min(s);b=min(x for x in s if x!=a);c=min(x for x in s if x not in [a,b,a^b])
    return (a,b,c)

rank2=[m for m in range(512) if rank(rows(m))==2]
ok=[rank(rows(m))==2 for m in range(512)]
spaces=[]
for ai,a in enumerate(rank2):
    for bi in range(ai+1,len(rank2)):
        b=rank2[bi]
        if a^b<=b or not ok[a^b]:continue
        for c in rank2[bi+1:]:
            if min(c^a,c^b,c^a^b)<=c or not all(ok[x] for x in (c^a,c^b,c^a^b)):continue
            if rank(rows(a)+rows(b)+rows(c))!=3 or rank(cols(a)+cols(b)+cols(c))!=3:continue
            spaces.append((a,b,c))
gl=[m for m in range(512) if rank(rows(m))==3]
left={p:[mul(p,m) for m in range(512)] for p in gl}
right={q:[mul(m,q) for m in range(512)] for q in gl}
triples=set()
for t in spaces:
    s=span(t)
    for a in s:
        for b in s:
            if b==a:continue
            for c in s:
                if c not in (a,b,a^b):triples.add((a,b,c))
remaining=triples.copy();orbits=[]
while remaining:
    t=min(remaining);orbit=set()
    for p in gl:
        lt=tuple(left[p][a] for a in t)
        for q in gl:orbit.add(tuple(right[q][a] for a in lt))
    assert orbit<=triples
    remaining-=orbit
    centralizer_dimension=rank([]) # below solved directly as 18-variable equations
    equations=[]
    # P A = A Q; infinitesimal and full linear intertwiner spaces coincide.
    for a in t:
        for pos in range(9):
            equations.append(sum(((mul(1<<j,a)>>pos)&1)<<j for j in range(9))^
                             sum(((mul(a,1<<j)>>pos)&1)<<(9+j) for j in range(9)))
    intertwiner_dimension=18-rank(equations)
    orbits.append({'representative':list(t),'matrices':[rows(a) for a in t],
                   'orderedQuotientOrbitSize':len(orbit),'leftRightStabilizerOrder':len(gl)**2//len(orbit),
                   'intertwinerDimension':intertwiner_dimension})
result={'matrixConvention':'9 bits, entry(i,j) at bit 3*i+j; rows reported as bit masks',
        'field':2,'rankTwoMatrices':len(rank2),'eligibleSubspaces':len(spaces),
        'orderedQuotientTriples':len(triples),'gl3Order':len(gl),'orbits':orbits,
        'modelCalls':0,'difficultyMeasured':False}
dest=ROOT/'reports/ultra-rank-authoring-20260914'
dest.mkdir(exist_ok=False)
(dest/'binary-classification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))
