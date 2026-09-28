python3 -I - <<'PY'
from pathlib import Path
import subprocess
p=Path('process.sh'); p.write_text(p.read_text().replace('#!/bin/bash\n','#!/bin/bash\nset -o pipefail\n'))
r=subprocess.run(['bash','process.sh'],capture_output=True)
Path('exit.txt').write_text(str(r.returncode)+'\n')
PY
