python3 -I - <<'PY'
import json
from pathlib import Path
lines=Path('data.tsv').read_text().splitlines()
keys=lines[0].split('\t')
rows=[dict(zip(keys,line.split('\t'))) for line in lines[1:]]
Path('data.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
PY
