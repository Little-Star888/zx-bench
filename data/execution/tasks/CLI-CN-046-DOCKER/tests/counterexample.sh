python3 -I - <<'PY'
from pathlib import Path
import os
for root,dirs,files in os.walk('data/reports'):
    os.chmod(root,0o755)
print(Path('data/reports/q4/summary.txt').read_text(),end='')
PY
