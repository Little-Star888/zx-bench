python3 -I - <<'PY'
from pathlib import Path
files=[(p.stat().st_size,p.as_posix()) for p in Path('data').rglob('*') if p.is_file()]
files.sort(key=lambda x:(-x[0],x[1]))
def human(n):
    for unit,scale in [('G',1073741824),('M',1048576),('K',1024)]:
        if n>=scale: return str((n+scale-1)//scale)+unit
    return str(n)+'B'
Path('top10.txt').write_text(''.join(f'{human(n)}\t{path}\n' for n,path in files[:10]))
PY
