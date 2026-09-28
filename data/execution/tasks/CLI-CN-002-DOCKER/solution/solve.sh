python3 - <<'PY'
import re
from pathlib import Path
text = Path('mixed.txt').read_text()
emails = sorted({m.lower() for m in re.findall(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', text)})
Path('emails.txt').write_text('\n'.join(emails) + '\n')
PY
