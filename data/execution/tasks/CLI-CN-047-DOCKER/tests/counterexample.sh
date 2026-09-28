python3 -I - <<'PY'
from pathlib import Path
print(len({line.split(',')[0] for line in Path('events.log').read_text().splitlines() if line.split(',')[0]}))
PY
