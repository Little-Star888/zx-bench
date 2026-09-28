python3 -I - <<'PY'
import base64,gzip
from pathlib import Path
encoded=Path('payload.txt').read_text().strip()
Path('original.txt').write_bytes(gzip.decompress(base64.b64decode(encoded)))
PY
