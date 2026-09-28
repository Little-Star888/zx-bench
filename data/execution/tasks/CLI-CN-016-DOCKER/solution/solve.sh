python3 -I - <<'PY'
import subprocess
from pathlib import Path
commits=subprocess.check_output(['git','-C','repo','rev-list','--reverse','HEAD'],text=True).splitlines()
for commit in commits:
    content=subprocess.check_output(['git','-C','repo','show',commit+':src/config.py'],text=True)
    if 'CRITICAL_TIMEOUT = 30' in content.splitlines():
        Path('answer.txt').write_text(commit+'\n'); break
PY
