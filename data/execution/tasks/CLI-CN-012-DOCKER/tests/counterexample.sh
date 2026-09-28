python3 -I - <<'PY'
from pathlib import Path
files=[(p.stat().st_size,p.as_posix()) for p in Path('data').rglob('*') if p.is_file()]
def human(n): return str((n+1023)//1024)+'K'
files.sort(key=lambda x:human(x[0]),reverse=True)
Path('top10.txt').write_text(''.join(f'{human(n)}\t{path}\n' for n,path in files[:10]))
PY
