python3 - <<'PY'
from pathlib import Path
from hashlib import sha256
groups = {}
for path in Path('files').iterdir():
    if path.is_file(): groups.setdefault(sha256(path.read_bytes()).hexdigest(), []).append(path)
for paths in groups.values():
    keep = min(paths, key=lambda path: path.stat().st_mtime)
    for path in paths:
        if path != keep: path.unlink()
PY
