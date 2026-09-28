python3 - <<'PY'
from pathlib import Path
for source in Path('/workspace').rglob('*.jpeg'):
    target = source.with_suffix('.jpg')
    if source.is_file() and not target.exists(): source.rename(target)
PY
