python3 -I - <<'PY'
import csv, json
from pathlib import Path
with open('data.tsv',newline='',encoding='utf-8') as f:
    rows=list(csv.DictReader(f,delimiter='\t'))
Path('data.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
PY
