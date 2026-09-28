"""One-off independent schema cross-check, not part of each inference run."""
import importlib.metadata
import json
from pathlib import Path
from jsonschema import Draft7Validator, FormatChecker

root = Path('data/pilots/structured-contract-v1')
rows = []
for split in ('development', 'holdout'):
    pack = json.loads((root / f'{split}.json').read_text(encoding='utf8'))
    gold = {x['id']: x for x in json.loads((root / f'{split}-gold.json').read_text(encoding='utf8'))}
    for scenario in pack:
        schema = scenario['requirements']['schema']
        Draft7Validator.check_schema(schema)
        validator = Draft7Validator(schema, format_checker=FormatChecker())
        fixture = gold[scenario['id']]
        good = validator.is_valid(fixture['expected'])
        bad = validator.is_valid(fixture['negative'])
        assert good and bad == (scenario['requirements']['family'] in ('C', 'D')), scenario['id']
        rows.append({'id': scenario['id'], 'goldSchemaValid': good, 'mutationSchemaValid': bad})
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf8'))
report = {'validator': 'python-jsonschema@' + importlib.metadata.version('jsonschema'), 'status': 'passed',
          'modelCalls': 0, 'scenarios': len(rows), 'packHashes': manifest['hashes'], 'rows': rows,
          'scope': 'Independent schema compliance cross-check; content fixture correctness is not independently proven by this check.'}
(root / 'independent-schema-gate.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
print(json.dumps({k: v for k, v in report.items() if k != 'rows'}))
