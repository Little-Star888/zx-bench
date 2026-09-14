"""Finish answer-key construction: extension-field profiles and determinant Jacobian.
No model calls. This does not estimate model difficulty.
"""
import json
from itertools import permutations,product
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
base=ROOT/'reports/ultra-rank-authoring-20260914'
binary=json.loads((base/'binary-classification.json').read_text())
def rank2(rows):
    basis=[]
    for v in rows:
        for b in basis:v=min(v,v^b)
        if v:basis.append(v);basis.sort(reverse=True)
    return len(basis)
def fm(a,b):
    x=0
    while b:
        if b&1:x^=a
        b>>=1;a<<=1
        if a&4:a^=7
    return x
def field_rank(a):
    a=[r[:] for r in a];r=0
    for c in range(3):
        p=next((p for p in range(r,3) if a[p][c]),None)
        if p is None:continue
        a[r],a[p]=a[p],a[r];inv=next(x for x in range(1,4) if fm(a[r][c],x)==1)
        a[r]=[fm(x,inv) for x in a[r]]
        for i in range(3):
            if i!=r:
                t=a[i][c];a[i]=[x^fm(t,y) for x,y in zip(a[i],a[r])]
        r+=1
    return r
points=[v for v in product(range(4),repeat=3) if any(v) and next(x for x in v if x)==1]
assert len(points)==21
profiles=Counter();detailed=[]
for orbit in binary['orbits']:
    mats=[[[m>>(3*i+j)&1 for j in range(3)] for i in range(3)] for m in orbit['representative']]
    counts=Counter()
    for v in points:
        a=[[0]*3 for _ in range(3)]
        for k in range(3):
            for i in range(3):
                for j in range(3):a[i][j]^=fm(v[k],mats[k][i][j])
        counts[field_rank(a)]+=1
    profile=tuple(counts.get(r,0) for r in [1,2,3]);profiles[profile]+=1
    detailed.append({**orbit,'f4ProjectiveRankProfile':list(profile)})
gl6=1
for i in range(6):gl6*=64-2**i
planes=gl6//(2**9*168**2)

# Determinant coefficient order x^3,x^2y,x^2z,xy^2,xyz,xz^2,y^3,y^2z,yz^2,z^3.
exponents=[(3,0,0),(2,1,0),(2,0,1),(1,2,0),(1,1,1),(1,0,2),(0,3,0),(0,2,1),(0,1,2),(0,0,3)]
perms=list(permutations(range(3)))
def det_coeff(mats):
    values=[0]*10
    for perm in perms:
        sign=(-1)**sum(perm[i]>perm[j] for i in range(3) for j in range(i+1,3))
        for choices in product(range(3),repeat=3):
            coef=sign
            for i in range(3):coef*=mats[choices[i]][i][perm[i]]
            exponent=tuple(choices.count(k) for k in range(3));values[exponents.index(exponent)]+=coef
    return values
alt=[[[0,0,0],[0,0,-1],[0,1,0]],[[0,0,1],[0,0,0],[-1,0,0]],[[0,-1,0],[1,0,0],[0,0,0]]]
assert det_coeff(alt)==[0]*10
columns=[]
for k,i,j in product(range(3),repeat=3):
    changed=[[row[:] for row in m] for m in alt];changed[k][i][j]+=1
    columns.append(sum((v%2)<<s for s,v in enumerate(det_coeff(changed))))
jacobian_rank=rank2(columns)
evaluation=[]
for v in product(range(2),repeat=3):
    if not any(v):continue
    mask=0
    for c,e in enumerate(exponents):
        val=1
        for a,b in zip(v,e):val*=a**b
        if val:mask|=1<<c
    evaluation.append(mask)
point_rank=rank2([sum(((mask&col).bit_count()%2)<<i for i,mask in enumerate(evaluation)) for col in columns])
assert jacobian_rank==10 and point_rank==7
result={'field2':{'eligibleSubspaces':binary['eligibleSubspaces'],'orderedQuotientTriples':binary['orderedQuotientTriples'],
                  'conjugacyClasses':len(binary['orbits']),'threePlanesInF2Six':planes,
                  'totalSixDimensionalTriples':planes*binary['orderedQuotientTriples'],
                  'centralizerOrderHistogram':dict(Counter(str(2**9*o['leftRightStabilizerOrder']) for o in binary['orbits']))},
        'extensionF4':{'projectivePoints':21,'rankProfileClassCounts':[{'profile':list(k),'classes':v,'sixDimensionalTriples':sum(planes*o['orderedQuotientOrbitSize'] for o in detailed if tuple(o['f4ProjectiveRankProfile'])==k)} for k,v in sorted(profiles.items())],
                       'orderedOrbits':detailed},
        'ringLifting':{'integerBaseMatrices':alt,'determinantCoefficientOrder':exponents,
                       'jacobianColumnMasks':columns,'jacobianRank':jacobian_rank,'binaryEvaluationRank':point_rank,
                       'mod4Lifts':2**20,'mod4NearIdentityOrbits':8,'mod4LiftsAdmittingMod8Lift':2**17,
                       'mod8Lifts':2**37,'generalCount':'2^(17*(k-1)+3), k>=2',
                       'generalNearIdentityOrbits':8,'generalLiftableCount':'2^(17*(k-1)), k>=2',
                       'basis':'determinant coefficient smoothness plus homogeneous cubic function kernel; proof in coordinator solution'},
        'modelCalls':0,'difficultyMeasured':False}
(base/'answer-key.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k not in ['extensionF4','ringLifting']}))
print(json.dumps({'f4Profiles':result['extensionF4']['rankProfileClassCounts'],'jacobianRank':jacobian_rank,'pointConstraintRank':point_rank}))
