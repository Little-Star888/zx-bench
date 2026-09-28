python3 - <<'PY'
from pathlib import Path
blocked = set(Path('b.txt').read_text().splitlines())
Path('only_in_a.txt').write_text(''.join(line for line in Path('a.txt').read_text().splitlines(keepends=True) if line.rstrip('\n') not in blocked))
PY
