python3 -I - <<'PY'
from pathlib import Path
from collections import Counter
import re
rows=[]
for line in Path('var/log/app/access.log').read_text().splitlines():
    m=re.match(r'^(\S+) - - \[([^]]+)\] ".*" (\d{3}) (\d+)$',line)
    if m and m.group(2).startswith('2026-09-26:'): rows.append((m.group(1),int(m.group(3)),int(m.group(4)),line))
counts=Counter(r[0] for r in rows)
top=sorted(counts.items(),key=lambda x:(-x[1],x[0]))[:10]
text='TOP_IPS\n'+''.join(f'{ip} {n}\n' for ip,n in top)
text+=f'AVG_MS {sum(r[2] for r in rows)/len(rows):.2f}\nERROR_5XX\n'
text+=''.join(r[3]+'\n' for r in rows if r[1]>=500)
Path('tmp').mkdir(exist_ok=True); Path('tmp/report.txt').write_text(text)
PY
