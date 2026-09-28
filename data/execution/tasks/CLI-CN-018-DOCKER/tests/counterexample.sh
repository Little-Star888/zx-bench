python3 -I - <<'PY'
from pathlib import Path
rows=[]
for path in Path('src').rglob('*.py'):
    rows.append((path.read_bytes().count(b'\n'),path.as_posix()))
rows.sort(key=lambda x:str(-x[0]))
Path('counts.txt').write_text(''.join(f'{n} {path}\n' for n,path in rows))
PY
