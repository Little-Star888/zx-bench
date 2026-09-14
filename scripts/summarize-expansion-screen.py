"""Summarize this fixed, single-attempt screen without additional model calls."""
import hashlib
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
pack_dir = root / 'reports/exam-expansion-screen-20260914'
read = lambda p: json.loads(p.read_text(encoding='utf-8'))
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest = read(pack_dir / 'manifest.json')
for path, expected in manifest['codeFiles'].items():
    assert digest(root / path) == expected, f'Frozen source changed: {path}'
paper = read(pack_dir / 'coordinator/frozen-pack.json')
runs = []
for provider in ['deepseek', 'qwen']:
    directory = root / f'reports/exam-expansion-screen-{provider}-20260914'
    status = read(directory / 'status.json')
    assert status['state'] != 'running', 'Wait for the already running attempts; do not start more.'
    scored = read(directory / 'scored.json')
    rows = []
    for row in scored['rows']:
        raw_path = directory / row['id'] / 'raw.json'
        if not raw_path.exists():
            rows.append(row)
            continue
        raw = read(raw_path)
        request = read(directory / row['id'] / 'request.json')
        rows.append({**row, 'content': raw['content'], 'finishReason': raw['finishReason'],
                     'latencyMs': raw['latencyMs'], 'usage': raw['usage'],
                     'returnedModels': raw['returnedModels'], 'maxTokens': request['body']['max_tokens'],
                     'rawPath': str(raw_path.resolve()), 'rawSha256': digest(raw_path)})
    runs.append({'provider': provider, 'modelId': scored['modelId'], 'score': scored['score'],
                 'earned': scored['earned'], 'points': scored['points'], 'comparable': scored['comparable'],
                 'groups': scored['groups'], 'rows': rows, 'status': status['state'],
                 'submissionSha256': digest(directory / 'submission.json'),
                 'plan': read(directory / 'plan.json')})
ledger_dir = root / 'reports/progressive-exam-expansion-v3-call-budget'
ledger = [read(p) for p in sorted(ledger_dir.glob('*.json'))]
assert len(ledger) <= 16
assert len({(p['run'], p['question']) for p in ledger}) == len(ledger), 'Repeated question attempt'
result = {'contractHash': paper['contractHash'], 'selectedGroups': paper['options']['groupIds'],
          'frozenSourcesVerified': True, 'modelRequestsReserved': len(ledger), 'requestLimit': 16,
          'automaticRetries': 0, 'runs': runs, 'ledger': ledger, 'productionEligible': False,
          'scope': 'Two preselected mathematical groups; one attempt per part per model; not a 12-group calibration.'}
result['groupReview'] = []
for group_id in paper['options']['groupIds']:
    scores = {r['modelId']: next(g['score'] for g in r['groups'] if g['groupId'] == group_id) for r in runs}
    values = [v for v in scores.values() if v is not None]
    result['groupReview'].append({'groupId': group_id, 'scores': scores,
                                 'observedSpread': max(values)-min(values) if len(values)==len(runs) else None,
                                 'allMeasuredModelsFullCredit': len(values)==len(runs) and all(v==100 for v in values),
                                 'strongModelCeilingUnresolved': runs[0]['groups'][paper['options']['groupIds'].index(group_id)]['score']==100,
                                 'productionEligible': False})
target = root / sys.argv[1]
with target.open('x', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)
print(json.dumps({'calls': len(ledger), 'runs': [{'model': r['modelId'], 'score': r['score'], 'groups': r['groups']} for r in runs]}))
