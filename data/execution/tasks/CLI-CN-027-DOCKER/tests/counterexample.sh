python3 -I - <<'PY'
import os,subprocess
from pathlib import Path
for root,dirs,files in os.walk('project'):
    os.chmod(root,0o755)
    for name in files: os.chmod(os.path.join(root,name),0o755)
Path('start.txt').write_bytes(subprocess.check_output(['./run.sh'],cwd='project'))
PY
