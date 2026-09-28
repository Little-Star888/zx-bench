python3 -I - <<'PY'
from pathlib import Path
import tarfile
root=Path('deploy'); root.mkdir(exist_ok=True)
with tarfile.open('release.tar.gz','r:gz') as tar:
    for m in tar.getmembers():
        parts=Path(m.name).parts
        if not m.isfile() or len(parts)<2 or parts[0]!='myapp-1.0': raise ValueError('unsafe archive')
        dest=root.joinpath(*parts[1:]); dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_bytes(tar.extractfile(m).read())
PY
