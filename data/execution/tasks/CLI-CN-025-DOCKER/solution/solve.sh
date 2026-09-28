python3 -I - <<'PY'
from pathlib import Path
import subprocess
p=Path('project/app.py'); p.write_text(p.read_text().replace('from util import helper','from utils import helper'))
r=subprocess.run(['pytest','-q','-p','no:cacheprovider'],cwd='project',capture_output=True,text=True)
if r.returncode: raise SystemExit(r.stderr+'\n'+r.stdout)
Path('test-status.txt').write_text('exit=0\n')
PY
