python3 -I - <<'PY'
from pathlib import Path
source=Path('names.txt').read_text().splitlines()
Path('sorted.txt').write_text('\n'.join(sorted(source))+'\n')
PY
