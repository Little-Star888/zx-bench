python3 -I - <<'PY'
from pathlib import Path
import subprocess
p=Path('code/Makefile'); p.write_text(p.read_text().replace('main.c','Main.c'))
subprocess.run(['make','build'],cwd='code',check=True,capture_output=True)
Path('output.txt').write_bytes(subprocess.check_output(['./app'],cwd='code'))
PY
