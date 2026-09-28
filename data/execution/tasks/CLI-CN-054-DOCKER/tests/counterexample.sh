python3 -I - <<'PY'
from pathlib import Path
rows=[]
for line in Path('ps_snapshot.txt').read_text().splitlines()[1:]:
    fields=line.split(); rows.append((fields[5],fields[1]))
rows.sort(reverse=True)
Path('top5.txt').write_text(''.join(f'{pid} {rss}\n' for rss,pid in rows[:5]))
PY
