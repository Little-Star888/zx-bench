"""Independent closed-world/ledger audit; does not change frozen scores."""
import itertools
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np


def evidence_audit(problem):
    n = len(problem['names'])
    worlds = np.arange(2 ** n, dtype=np.uint32)
    constraints = []
    for c in problem['constraints']:
        values = np.bitwise_count(worlds & sum(1 << i for i in c['members']))
        constraints.append(values == c['count'] if c['kind'] == 'eq' else
                           values >= c['count'] if c['kind'] == 'ge' else values <= c['count'])
    complete = np.logical_and.reduce(constraints)
    possible = worlds[complete]
    fixed = [i for i in range(n) if len(np.unique((possible >> i) & 1)) == 1]
    claims = []
    for claim in problem['claims']:
        truth = np.bitwise_count(worlds & sum(1 << i for i in claim['members'])) >= claim['threshold']
        status = 'supported' if truth[complete].all() else 'refuted' if not truth[complete].any() else 'insufficient'
        needed = None
        certificate = []
        if status != 'insufficient':
            for size in range(1, len(constraints) + 1):
                for indices in itertools.combinations(range(len(constraints)), size):
                    selected = np.logical_and.reduce([constraints[i] for i in indices])
                    if (status == 'supported' and truth[selected].all()) or (status == 'refuted' and not truth[selected].any()):
                        needed = size
                        certificate = [problem['constraints'][i]['id'] for i in indices]
                        break
                if needed is not None:
                    break
        claims.append({'id': claim['id'], 'status': status, 'minimumDecidingReports': needed,
                       'exampleSufficientReports': certificate})
    return {'variables': n, 'reports': len(constraints), 'possibleWorlds': len(possible),
            'distinctClaimGroups': len({tuple(sorted(c['members'])) for c in problem['claims']}),
            'fixedVariables': len(fixed), 'claims': claims}


def ledger_audit(problem):
    cutoff = problem['cutoff']
    selected, decisions = {}, {}
    for entry in sorted(problem['entries'], key=lambda e: e['revision']):
        if not entry['draft'] and entry['recorded'] <= cutoff:
            selected[entry['id']] = entry
    for decision in sorted(problem['decisions'], key=lambda d: d['revision']):
        if decision['recorded'] <= cutoff:
            decisions[decision['tx']] = decision['decision']
    records, counts = {}, Counter()
    def resolve(handle, time):
        matches = [b['entity_id'] for b in problem['bindings'] if b['handle'] == handle and b['start'] <= time < b['end']]
        return matches[0] if len(matches) == 1 else None
    for entry in sorted(selected.values(), key=lambda e: (e['time'], e['id'])):
        if entry['time'] > cutoff or decisions.get(entry['tx']) != 'commit':
            counts['excludedAfterVersionSelection'] += 1
            continue
        entity = resolve(entry['handle'], entry['time'])
        if entity is None:
            counts['unresolved'] += 1
            continue
        op = entry['op']
        kind = op['kind']
        counts['replayed'] += 1
        if kind == 'put':
            records[entity] = dict(entity_id=entity, label=op['values']['label'],
                                   quantity=op['values'].get('quantity', 0),
                                   due_date=op['values'].get('due_date'), owner=op['values'].get('owner'))
        elif kind == 'delete':
            records.pop(entity, None)
        elif entity not in records:
            counts['absentRecordNoOp'] += 1
        elif kind == 'patch':
            records[entity].update(op['values'])
        elif kind == 'delta':
            records[entity]['quantity'] += op['amount']
        elif kind == 'move':
            target = resolve(op['target'], entry['time'])
            if target != entity and target in records and records[entity]['quantity'] >= op['amount']:
                counts['executedTransfers'] += 1
                records[entity]['quantity'] -= op['amount']
                records[target]['quantity'] += op['amount']
            else:
                counts['conditionalTransferNoOp'] += 1
    return {'records': [records[key] for key in sorted(records)], 'counts': dict(counts),
            'inputEntries': len(problem['entries']), 'selectedVersions': len(selected)}


def main():
    source, target = map(Path, sys.argv[1:])
    pack = json.loads(source.read_text(encoding='utf-8'))
    rows = []
    for case in pack['cases']:
        if case['dimension'] == 'hallucination_resistance':
            result = evidence_audit(case['problem'])
            assert [c['status'] for c in result['claims']] == [c['status'] for c in case['reference']['claims']]
        elif case['dimension'] == 'data_extraction':
            result = ledger_audit(case['problem'])
            assert result['records'] == case['reference']['records'], 'Independent ledger replay disagrees'
            result['referenceMatches'] = True
            del result['records']
        else:
            continue
        rows.append(dict(id=case['id'], tier=case['tier'], dimension=case['dimension'], **result))
    with target.open('x', encoding='utf-8') as output:
        json.dump({'source': str(source.resolve()), 'rows': rows}, output, ensure_ascii=False, indent=2)
    print(json.dumps(rows, ensure_ascii=True))


if __name__ == '__main__':
    main()
