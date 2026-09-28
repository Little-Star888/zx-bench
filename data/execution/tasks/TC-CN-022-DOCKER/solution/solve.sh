python3 -I - <<'PY'
from pathlib import Path
import tarfile,datetime
cutoff=datetime.datetime(2026,9,19,12,tzinfo=datetime.timezone.utc).timestamp()
files=sorted(p for p in Path('data/logs').rglob('*.log') if p.is_file() and p.stat().st_mtime<cutoff)
with tarfile.open('archive.tar.gz','w:gz') as tar:
    for p in files: tar.add(p,arcname=p.as_posix())
for p in files: p.unlink()
print(len(files))
PY
