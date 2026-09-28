python3 - <<'PY'
from pathlib import Path
for source in Path('/workspace').rglob('*.jpeg'):
    if source.is_file(): source.rename(source.with_suffix('.jpg'))
PY
