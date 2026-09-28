python3 -I - <<'PY'
import subprocess
from pathlib import Path
with open('emails.txt','w') as out:
    subprocess.run(['jq','-r','.users[].email','data.json'],check=True,stdout=out)
PY
