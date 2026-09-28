python3 -I - <<'PY'
from pathlib import Path
import subprocess
r=subprocess.run(['bash','process.sh'],capture_output=True)
Path('exit.txt').write_text('1\n')
PY
