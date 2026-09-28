python3 -I - <<'PY'
from pathlib import Path
source=Path('names.txt').read_text().splitlines()
expected='\n'.join(sorted(source))+'\n'
target=Path('sorted.txt')
if not target.exists() or target.read_text()!=expected: target.write_text(expected)
PY
