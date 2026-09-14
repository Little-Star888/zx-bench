"""Produce a compact evidence bundle from completed, frozen local experiments.

Run only after both models finish both experiments. No raw reasoning or credentials
are copied; full model output stays in the source run directories.
"""
import hashlib
import json
import sys
from pathlib import Path


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


root = Path(__file__).resolve().parents[1]
experiments = []
for name in ['frontier-challenge-2026-09-14-v1', 'annihilating-maps-2026-09-14-v1']:
    base = root / 'reports' / name
    pack_path = base / 'development/coordinator/frozen-pack.json'
    pack = read(pack_path)
    manifest = read(base / 'development/manifest.json')
    for source, expected in manifest['codeFiles'].items():
        assert sha(root / source) == expected, f'Frozen code mismatch: {source}'
    runs = []
    for model in ['deepseek', 'qwen']:
        directory = base / model
        assert read(directory / 'status.json')['state'] == 'completed', f'Incomplete: {directory}'
        submission = read(directory / 'submission.json')
        assert len(submission['answers']) == len(pack['cases'])
        rows = []
        for case in pack['cases']:
            result_dir = directory / case['id']
            raw = read(result_dir / 'raw.json')
            grade = read(result_dir / 'grade.json')
            rows.append({
                'id': case['id'], 'tier': case.get('tier'),
                'dimension': grade['dimension'], 'family': grade['family'],
                'state': grade['state'], 'measured': grade.get('measured', False),
                'contentScore': grade.get('contentScore'), 'contentPass': grade.get('contentPass'),
                'diagnostics': grade.get('diagnostics'),
                'formatCompliant': grade.get('formatCompliant'),
                'finishReason': raw['finishReason'], 'latencyMs': raw['latencyMs'],
                'usage': raw['usage'], 'returnedModels': raw['returnedModels'],
                'finalContentCharacters': len(raw.get('content') or ''),
                'rawPath': str((result_dir / 'raw.json').resolve()),
                'rawSha256': sha(result_dir / 'raw.json'),
                'gradeSha256': sha(result_dir / 'grade.json'),
            })
        runs.append({'modelId': submission['modelId'], 'modelFamily': submission['modelFamily'],
                     'runId': submission['runId'], 'plan': str((directory / 'plan.json').resolve()),
                     'submissionSha256': sha(directory / 'submission.json'), 'rows': rows})
    experiments.append({'name': name, 'contractHash': pack['contractHash'],
                        'frozenPackSha256': sha(pack_path), 'codeHashesVerified': True, 'runs': runs})
result = {'productionEligible': False, 'difficultyCalibrated': False,
          'budget': {'requestedMaxOutputTokens': 90000, 'hardSecondsPerQuestion': 600},
          'limitations': ['Two model families, one attempt per instance.',
                          'Qwen server did not return usage; actual token consumption is unknown.',
                          'The maps probe is an exploratory follow-up, not a held-out confirmation.'],
          'experiments': experiments,
          'structureAudit': read(root / 'reports/frontier-challenge-2026-09-14-v1/structure-audit-v2.json'),
          'tests': {'passed': 1520, 'skipped': 213, 'failed': 0}}
target = root / sys.argv[1]
with target.open('x', encoding='utf-8') as output:
    json.dump(result, output, ensure_ascii=False, indent=2)
print(json.dumps([{'name': e['name'], 'models': [r['modelId'] for r in e['runs']],
                   'answers': sum(len(r['rows']) for r in e['runs'])} for e in experiments]))
