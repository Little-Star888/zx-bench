python3 -I - <<'PY'
from pathlib import Path
Path('validation.txt').write_text('exit=0\n')
PY
