python3 -I - <<'PY'
import subprocess
from pathlib import Path
order=['dns','ping','port443','route','firewall','proxy','capture']
lines=[]
for name in order:
    command=['./diagtool',name]+(['--seconds','10'] if name=='capture' else [])
    value=subprocess.check_output(command,text=True).strip()
    lines.append(name.upper()+' '+value)
Path('network-report.txt').write_text('\n'.join(lines)+'\n')
PY
