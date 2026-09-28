python3 -I - <<'PY'
from pathlib import Path
import subprocess
p=Path('run.sh'); p.write_text(p.read_text()+'#!/bin/bash\n')
Path('run-output.txt').write_bytes(subprocess.check_output(['bash','run.sh']))
PY
