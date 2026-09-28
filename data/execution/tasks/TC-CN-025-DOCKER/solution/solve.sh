python3 -I - <<'PY'
from pathlib import Path
import os,signal
rows=[]
for line in Path('ps_snapshot.txt').read_text().splitlines()[1:]:
    col=line.split(); rows.append((int(col[1]),int(col[2]),int(col[5]),' '.join(col[10:])))
heavy=sorted(pid for pid,cpu,rss,cmd in rows if rss>500000)
top=[pid for pid,cpu,rss,cmd in sorted(rows,key=lambda x:(-x[1],x[0]))[:5]]
py=[pid for pid,cpu,rss,cmd in rows if cmd.startswith('python')]
pid=int(Path('target.pid').read_text()); os.kill(pid,signal.SIGTERM)
report=f"HEAVY {','.join(map(str,heavy))}\nCPU_TOP5 {','.join(map(str,top))}\nPYTHON {','.join(map(str,py))}\n"
Path('diagnostics.txt').write_text(report+Path('system.txt').read_text()+'SIGNAL SIGTERM\n')
PY
