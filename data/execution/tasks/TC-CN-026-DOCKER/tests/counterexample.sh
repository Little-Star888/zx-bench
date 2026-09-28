python3 -I - <<'PY'
import subprocess
from pathlib import Path
order=['dns','ping','port443','route','firewall','proxy']
lines=[]
for name in order:
    value=subprocess.check_output(['./diagtool',name],text=True).strip()
    lines.append(name.upper()+' '+value)
Path('network-report.txt').write_text('\n'.join(lines)+'\n')
PY
