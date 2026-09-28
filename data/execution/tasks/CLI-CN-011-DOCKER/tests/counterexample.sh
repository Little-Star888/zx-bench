python3 -I - <<'PY'
from pathlib import Path
for line in Path('spec.txt').read_text().splitlines():
    raw,mode,*flags=line.split()
    path=Path(raw.rstrip('/'))
    if raw.endswith('/'):
        path.mkdir(parents=True,exist_ok=True)
    else:
        path.parent.mkdir(parents=True,exist_ok=True)
        path.touch()
PY
