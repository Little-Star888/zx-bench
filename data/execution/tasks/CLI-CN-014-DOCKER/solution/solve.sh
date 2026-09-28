python3 - <<'PY'
from pathlib import Path
rows = []
for path in sorted(Path('logs').glob('*.log')):
    rows += [f'{path.name}:{line}' for line in path.read_text().splitlines() if line.startswith('ERROR')]
Path('errors.txt').write_text('\n'.join(rows) + '\n')
PY
