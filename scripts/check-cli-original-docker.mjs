import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cliCommandEvaluator, validateScenario } from '../packages/core/dist/index.js';

const scenarios = JSON.parse(fs.readFileSync('data/pilots/cli-original-docker-v1.json', 'utf8'));
export const references = {
  'CLI-CN-002': `python3 - <<'PY'
import re
from pathlib import Path
text = Path('mixed.txt').read_text()
emails = sorted({m.lower() for m in re.findall(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', text)})
Path('emails.txt').write_text('\\n'.join(emails) + '\\n')
PY`,
  'CLI-CN-003': `python3 - <<'PY'
from pathlib import Path
blocked = set(Path('b.txt').read_text().splitlines())
Path('only_in_a.txt').write_text(''.join(line for line in Path('a.txt').read_text().splitlines(keepends=True) if line.rstrip('\\n') not in blocked))
PY`,
  'CLI-CN-004': `python3 - <<'PY'
import re
from pathlib import Path
text = Path('report.txt').read_text()
Path('redacted.txt').write_text(re.sub(r'---BEGIN NOTE---\\n.*?---END NOTE---', '[REDACTED]', text, flags=re.S))
PY`,
  'CLI-CN-006': 'sort -k2,2nr scores.txt',
  'CLI-CN-007': `python3 - <<'PY'
from pathlib import Path
for source in Path('/workspace').rglob('*.jpeg'):
    target = source.with_suffix('.jpg')
    if source.is_file() and not target.exists(): source.rename(target)
PY`,
  'CLI-CN-008': `python3 - <<'PY'
from pathlib import Path
from datetime import datetime, timedelta
from shutil import move
now = datetime.fromisoformat(Path('.now').read_text().strip().replace('Z', '+00:00')).timestamp()
archive = Path('archive')
for source in Path('in').iterdir():
    if source.is_file() and source.stat().st_mtime < now - timedelta(days=30).total_seconds():
        archive.mkdir(exist_ok=True)
        move(str(source), str(archive / source.name))
PY`,
  'CLI-CN-009': `python3 - <<'PY'
from pathlib import Path
from hashlib import sha256
groups = {}
for path in Path('files').iterdir():
    if path.is_file(): groups.setdefault(sha256(path.read_bytes()).hexdigest(), []).append(path)
for paths in groups.values():
    keep = min(paths, key=lambda path: path.stat().st_mtime)
    for path in paths:
        if path != keep: path.unlink()
PY`,
  'CLI-CN-014': `python3 - <<'PY'
from pathlib import Path
rows = []
for path in sorted(Path('logs').glob('*.log')):
    rows += [f'{path.name}:{line}' for line in path.read_text().splitlines() if line.startswith('ERROR')]
Path('errors.txt').write_text('\\n'.join(rows) + '\\n')
PY`,
  'CLI-CN-017': `awk '{print $9}' access.log | sort | uniq -c | sort -nr | awk '{print $1 " " $2}'`,
  'CLI-CN-049': 'tail -n 10 app.log',
  'CLI-CN-050': 'wc -l < data.csv',
  'CLI-CN-051': `grep -w 'error' syslog.txt`,
  'CLI-CN-053': `find logs -type f -name '*.log' | wc -l`,
  'CLI-CN-056': `sed -i 's/foo/bar/g' config.txt`,
};
export const counterexamples = {
  'CLI-CN-002': `grep -Eo '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}' mixed.txt | sort -u > emails.txt`,
  'CLI-CN-003': `sort -u a.txt | grep -vFf b.txt > only_in_a.txt`,
  'CLI-CN-004': `python3 - <<'PY'
import re
from pathlib import Path
Path('redacted.txt').write_text(re.sub(r'---BEGIN NOTE---\\n.*---END NOTE---', '[REDACTED]', Path('report.txt').read_text(), flags=re.S))
PY`,
  'CLI-CN-006': 'sort -k2,2r scores.txt',
  'CLI-CN-007': `python3 - <<'PY'
from pathlib import Path
for source in Path('/workspace').rglob('*.jpeg'):
    if source.is_file(): source.rename(source.with_suffix('.jpg'))
PY`,
  'CLI-CN-008': `mkdir -p archive; find in -type f -mtime +30 -exec mv {} archive/ \\;`,
  'CLI-CN-009': `python3 - <<'PY'
from pathlib import Path
from hashlib import sha256
groups = {}
for path in Path('files').iterdir():
    if path.is_file(): groups.setdefault(sha256(path.read_bytes()).hexdigest(), []).append(path)
for paths in groups.values():
    keep = max(paths, key=lambda path: path.stat().st_mtime)
    for path in paths:
        if path != keep: path.unlink()
PY`,
  'CLI-CN-014': `grep 'ERROR' logs/*.log > errors.txt`,
  'CLI-CN-017': `awk '{print $10}' access.log | sort | uniq -c | sort -nr | awk '{print $1 " " $2}'`,
  'CLI-CN-049': 'head -n 10 app.log',
  'CLI-CN-050': `wc -c data.csv`,
  'CLI-CN-051': `grep 'error' syslog.txt`,
  'CLI-CN-053': `find logs -maxdepth 1 -type f -name '*.log' | wc -l`,
  'CLI-CN-056': `sed -i 's/foo/bar/' config.txt`,
};
const meta = { finishReason: 'stop', truncated: false, containsCodeBlock: false,
  containsFinalConclusion: true, outputLength: 1, outputTokens: 1, inputTokens: 1,
  maxTokens: 100, incomplete: false };
const negativeOnly = process.argv.includes('--negative-only');
const requested = process.argv.find((arg) => arg.startsWith('--source='))?.slice('--source='.length);
const simpleOnly = process.argv.includes('--simple-only');
const filesystemOnly = process.argv.includes('--filesystem-only');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) for (const scenario of scenarios) {
  const sourceId = scenario.requirements.migrationSourceId;
  if (requested && sourceId !== requested) continue;
  if (simpleOnly && Number(sourceId.slice(-3)) < 49) continue;
  if (filesystemOnly && ![7, 8, 9].includes(Number(sourceId.slice(-3)))) continue;
  const validation = validateScenario(scenario);
  if (validation.errors.length) throw new Error(`${sourceId}: ${JSON.stringify(validation.errors)}`);
  const reference = references[sourceId];
  if (!reference) throw new Error(`No reference for ${sourceId}`);
  const positive = negativeOnly ? { totalScore: 100 } :
    await cliCommandEvaluator.evaluate(scenario, reference, { ...meta });
  const negative = await cliCommandEvaluator.evaluate({ ...scenario,
    requirements: { ...scenario.requirements, executionCases: scenario.requirements.executionCases.slice(0, 1) } },
  counterexamples[sourceId], { ...meta });
  if (positive.totalScore !== 100 || negative.totalScore === 100 || positive.environmentError || negative.environmentError) {
    throw new Error(`${sourceId}: positive=${positive.totalScore} negative=${negative.totalScore} `
      + `positiveEvidence=${JSON.stringify(positive.evidence)} negativeEvidence=${JSON.stringify(negative.evidence)}`);
  }
  if (sourceId === 'CLI-CN-050' && !negativeOnly) {
    const alternate = await cliCommandEvaluator.evaluate({ ...scenario,
      requirements: { ...scenario.requirements, executionCases: scenario.requirements.executionCases.slice(0, 1) } },
    'wc -l data.csv', { ...meta });
    if (alternate.totalScore !== 100) throw new Error('CLI-CN-050: valid wc output with filename was rejected');
  }
  console.log(`${sourceId}: reference 100, core-error counterexample ${negative.totalScore}`);
}
