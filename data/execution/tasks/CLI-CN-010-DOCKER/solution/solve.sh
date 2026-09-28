python3 -I - <<'PY'
from pathlib import Path
import shutil
out = Path('flat'); out.mkdir(exist_ok=True)
for src in sorted(Path('nested').rglob('*'), key=lambda p: p.as_posix()):
    if not src.is_file() or src.is_symlink(): continue
    target = out / src.name
    n = 0
    while target.exists() or target.is_symlink():
        n += 1; target = out / (src.name + '_' + str(n))
    shutil.move(str(src), str(target))
PY
