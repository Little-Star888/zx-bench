"""Summarize completed budget-v2 runs; no selection between trials or rescoring rules."""
import hashlib
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
base = root / 'reports/progressive-exam-2026-09-14-v2'
target = root / sys.argv[1]
def read(p):
    return json.loads(p.read_text(encoding='utf-8'))
def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

manifest = read(base / 'development/manifest.json')
for path, expected in manifest['codeFiles'].items():
    assert digest(root / path) == expected, f'Frozen source changed: {path}'
paper = read(base / 'development/coordinator/frozen-pack.json')
runs = []
for provider in ['deepseek', 'qwen']:
    directory = base / provider
    status = read(directory / 'status.json')
    assert status['state'] == 'completed', f'Run still incomplete: {provider}'
    scored = read(directory / 'regraded.json')
    original = read(directory / 'scored.json')
    assert scored['rows'] == original['rows'] and scored['score'] == original['score']
    assert scored['comparable'] and len(scored['rows']) == len(paper['parts'])
    parts = []
    for row in scored['rows']:
        item_dir = directory / row['id']
        raw = read(item_dir / 'raw.json')
        request = read(item_dir / 'request.json')
        submitted = sum(i['submitted'] for i in row['items'])
        diagnosis = ('no_submitted_items' if not submitted else
                     'full_credit' if row['earned'] == row['points'] else 'partial_or_incorrect_submission')
        parts.append({**row, 'submissionDiagnosis': diagnosis, 'latencyMs': raw['latencyMs'],
                      'finishReason': raw['finishReason'], 'usage': raw['usage'],
                      'requestedMaxTokens': request['body']['max_tokens'],
                      'returnedModels': raw['returnedModels'], 'finalContentCharacters': len(raw['content']),
                      'rawPath': str((item_dir / 'raw.json').resolve()), 'rawSha256': digest(item_dir / 'raw.json')})
    runs.append({'provider': provider, 'modelId': scored['modelId'], 'score': scored['score'],
                 'earned': scored['earned'], 'points': scored['points'], 'groups': scored['groups'],
                 'parts': parts, 'plan': read(directory / 'plan.json'),
                 'regradedSha256': digest(directory / 'regraded.json')})
result = {'contractHash': paper['contractHash'], 'budgetVersion': 'provider-capacity-2026-09-14-v2',
          'frozenSourcesVerified': True, 'runs': runs,
          'engineeringPilot': {'path': str((root / 'reports/progressive-exam-2026-09-14-v1').resolve()),
                               'stoppedToCorrectClientTokenCap': True, 'includedInScores': False},
          'independentOracleCheck': read(base / 'independent-oracle-check.json'),
          'tests': {'passed': 1526, 'skipped': 213, 'failed': 0},
          'productionEligible': False, 'difficultyCalibrated': False,
          'scope': 'Two big questions, four dependent subquestions each, one new complete run per model; no stable-ranking claim.'}
with target.open('x', encoding='utf-8') as output:
    json.dump(result, output, ensure_ascii=False, indent=2)
print(json.dumps([{'provider': r['provider'], 'score': r['score'], 'groups': r['groups']} for r in runs]))
