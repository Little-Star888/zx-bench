python3 -I - <<'PY'
from pathlib import Path
import subprocess
p=Path('run.sh'); p.write_text('#!/bin/bash\n'+p.read_text())
Path('run-output.txt').write_bytes(subprocess.check_output(['./run.sh']))
PY
