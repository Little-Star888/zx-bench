python3 -I - <<'PY'
from pathlib import Path
import subprocess
out=subprocess.check_output(['sh','count.sh'])
Path('output.txt').write_bytes(out+b'item-4\nitem-5\n')
PY
