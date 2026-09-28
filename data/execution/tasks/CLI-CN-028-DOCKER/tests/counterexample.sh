python3 -I - <<'PY'
from pathlib import Path
import subprocess
Path('code/main.c').symlink_to('Main.c')
subprocess.run(['make','build'],cwd='code',check=True,capture_output=True)
Path('output.txt').write_bytes(subprocess.check_output(['./app'],cwd='code'))
PY
