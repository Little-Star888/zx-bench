python3 -I - <<'PY'
import subprocess
from pathlib import Path
commit=subprocess.check_output(['git','-C','repo','log','-1','--format=%H','-S','CRITICAL_TIMEOUT = 30','--','src/config.py'],text=True)
Path('answer.txt').write_text(commit)
PY
