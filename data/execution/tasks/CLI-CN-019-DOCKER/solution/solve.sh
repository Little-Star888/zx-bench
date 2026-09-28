python3 -I - <<'PY'
from pathlib import Path
import tarfile
Path('extracted').mkdir(exist_ok=True)
with tarfile.open('bundle.tar.gz','r:gz') as tar:
    tar.extract('deep/nested/target.conf','extracted',filter='data')
PY
