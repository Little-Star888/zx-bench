python3 -I - <<'PY'
from pathlib import Path
rows=[]
for line in Path('etc/passwd').read_text().splitlines():
    parts=line.split(':')
    if parts[-1]=='/bin/bash' and int(parts[2])>=1000: rows.append((parts[2],parts[0]))
rows.sort()
Path('users.txt').write_text(''.join(f'{name}:{uid}\n' for uid,name in rows)+f'TOTAL {len(rows)}\n')
PY
