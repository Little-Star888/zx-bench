python3 -I - <<'PY'
from pathlib import Path
import os
os.chmod('data/reports/q4',0o755)
print(Path('data/reports/q4/summary.txt').read_text(),end='')
PY
