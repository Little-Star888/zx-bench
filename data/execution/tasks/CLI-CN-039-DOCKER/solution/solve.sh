python3 -I - <<'PY'
from pathlib import Path
port=None; status=None
for line in Path('todo.txt').read_text().splitlines():
    parts=line.split(' ',1)
    if len(parts)!=2: continue
    if parts[0]=='SET_PORT' and parts[1].isdigit(): port=parts[1]
    elif parts[0]=='WRITE_STATUS': status=parts[1]
if port is None or status is None: raise SystemExit('missing local tasks')
conf=Path('config.ini'); conf.write_text(conf.read_text().replace('port=8080','port='+port))
Path('status.txt').write_text(status+'\n')
PY
