python3 -I - <<'PY'
from pathlib import Path
import shutil
Path('processed').mkdir(exist_ok=True)
for p in Path('files').iterdir():
    if p.is_file(): shutil.copyfile(p,Path('processed')/p.name)
PY
