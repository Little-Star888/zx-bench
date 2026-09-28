python3 -I - <<'PY'
from pathlib import Path
import subprocess
Path('process_files.sh').write_text("#!/bin/sh\nset -eu\nmkdir -p processed\nfor f in files/*; do\n  [ -f \"$f\" ] || continue\n  name=${f##*/}\n  cp -- \"$f\" \"processed/$name\"\ndone\n")
subprocess.run(['sh','process_files.sh'],check=True)
PY
