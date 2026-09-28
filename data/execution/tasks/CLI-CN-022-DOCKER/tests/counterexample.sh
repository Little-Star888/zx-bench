python3 -I - <<'PY'
from pathlib import Path
Path('slice.hex').write_text(Path('binary.dat').read_bytes()[100:199].hex().upper())
PY
