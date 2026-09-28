python3 - <<'PY'
import re
from pathlib import Path
Path('redacted.txt').write_text(re.sub(r'---BEGIN NOTE---\n.*---END NOTE---', '[REDACTED]', Path('report.txt').read_text(), flags=re.S))
PY
