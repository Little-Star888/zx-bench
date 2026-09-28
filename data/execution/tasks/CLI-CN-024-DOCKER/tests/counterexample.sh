python3 -I - <<'PY'
import tarfile
from pathlib import Path
Path('deploy').mkdir(exist_ok=True)
with tarfile.open('release.tar.gz','r:gz') as tar: tar.extractall('deploy',filter='data')
PY
