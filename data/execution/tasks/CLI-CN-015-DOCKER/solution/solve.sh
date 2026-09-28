python3 -I - <<'PY'
from pathlib import Path
matches=[]
for line in Path('ps_snapshot.txt').read_text().splitlines()[1:]:
    cols=line.split()
    if cols[0]=='alice' and int(cols[5])>50000: matches.append(int(cols[1]))
Path('alice_heavy.txt').write_text(''.join(f'{pid}\n' for pid in sorted(matches)))
PY
