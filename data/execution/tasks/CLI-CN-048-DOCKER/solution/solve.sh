python3 -I - <<'PY'
from pathlib import Path
import subprocess
Path('session.sh').write_text('export PATH="/workspace/opt/mytool/bin:$PATH"\nhash -r\nmytool\n')
Path('output.txt').write_bytes(subprocess.check_output(['bash','session.sh']))
PY
