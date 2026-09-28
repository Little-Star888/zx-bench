python3 - <<'PY'
import re
from pathlib import Path
text = Path('report.txt').read_text()
Path('redacted.txt').write_text(re.sub(r'---BEGIN NOTE---\n.*?---END NOTE---', '[REDACTED]', text, flags=re.S))
PY
