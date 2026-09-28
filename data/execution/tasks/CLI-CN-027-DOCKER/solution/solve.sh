python3 -I - <<'PY'
import os,subprocess
from pathlib import Path
os.chmod('project/run.sh',0o755); os.chmod('project/etc',0o755)
Path('start.txt').write_bytes(subprocess.check_output(['./run.sh'],cwd='project'))
PY
