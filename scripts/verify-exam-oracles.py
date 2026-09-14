"""Cross-check the frozen exam against a prior MILP proof and separate counting formulas."""
import hashlib
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
directory = root / sys.argv[1]
pack = json.loads((directory / 'coordinator/frozen-pack.json').read_text(encoding='utf-8'))
old_path = root / 'reports/frontier-challenge-2026-09-14-v1/development/coordinator/frozen-pack.json'
old = json.loads(old_path.read_text(encoding='utf-8'))
milp_path = root / 'reports/frontier-challenge-2026-09-14-v1/independent-oracle-check.json'
milp = json.loads(milp_path.read_text(encoding='utf-8'))
parts = pack['parts']
p = parts[1]['items'][0]['problem']
previous = next(c for c in old['cases'] if c['dimension'] == 'reasoning_math' and c['tier'] == 1)
assert p == previous['problem'], 'Prior MILP proof covers a different optimization instance'
proof = next(c for c in milp['checks'] if c['id'] == previous['id'])
assert proof['matched'] and proof['mipGap'] == 0 and proof['value'] == previous['reference']['value']
assert parts[2]['items'][0]['targets'] == [217, 289, 343]
x = json.loads(re.search(r'给定x=(\[.*?\])', parts[0]['task']).group(1))
value = sum(a*b for a,b in zip(x,p['bias'])) + sum(w*(x[i] != x[j]) for i,j,w in p['edges'])
cost = sum(a*b for a,b in zip(x,p['costs']))
valid = p['minSelected'] <= sum(x) <= p['maxSelected'] and cost <= p['budget']
valid = valid and all(sum(x[i] for i in g['members']) % 2 == g['parity'] for g in p['parityGroups'])
valid = valid and all(x[i] <= x[j] for i,j in p['requires'])
assert {i['key']:i['expected'] for i in parts[0]['items']} == dict(value=value,cost=cost,selected=sum(x),feasible=valid)
# For fixed quotient surjection f:F_2^4->F_2^2, g has rank(f+g)=1,2,3
# in respectively 2,64,144 cases. Same-kernel cases are 2,4,0; the
# remaining cases are 0,60,144. There are 210 f and 127*63*62 image pairs.
images = 127 * 63 * 62
expected = dict(equal_1=images*210*2, equal_2=images*210*4, equal_3=0,
                different_1=0, different_2=images*210*60, different_3=images*210*144)
assert {i['key']:int(i['expected']) for i in parts[7]['items']} == expected
assert int(parts[6]['items'][0]['expected']) == expected['equal_2'] + expected['different_2']
assert int(parts[5]['items'][0]['expected']) == 2667 * 930 * 112 * 42
assert {i['key']:i['expected'] for i in parts[4]['items']} == dict(d=3,m=4,annihilated=True)
target = root / sys.argv[2]
with target.open('x', encoding='utf-8') as output:
    json.dump({'contractHash': pack['contractHash'], 'allMatched': True, 'modelCalls': 0,
               'optimization': {'value': proof['value'], 'source': str(milp_path.resolve()),
                                'proofFileSha256': hashlib.sha256(milp_path.read_bytes()).hexdigest(),
                                'identicalProblemChecked': True},
               'mapsIndependentClosedFormHistogram': expected,
               'scope': 'Default seed 20260915 pilot only; not a generic oracle for arbitrary papers'}, output, indent=2)
print(json.dumps({'allMatched': True, 'optimization': proof['value'], 'histogram': expected}))
