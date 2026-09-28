python3 -I - <<'PY'
from pathlib import Path
import subprocess
p=Path('count.sh'); p.write_text(p.read_text().replace('for i in 1 2 3;','for i in 1 2 3 4 5;'))
out=subprocess.check_output(['sh','count.sh'])
Path('output.txt').write_bytes(out)
PY
