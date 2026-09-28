python3 -I - <<'PY'
from pathlib import Path
import datetime
cutoff=datetime.datetime(2026,9,19,12,tzinfo=datetime.timezone.utc).timestamp()
for p in Path('cache').rglob('*.tmp'):
    if p.is_file() and p.stat().st_mtime<cutoff: p.unlink()
PY
