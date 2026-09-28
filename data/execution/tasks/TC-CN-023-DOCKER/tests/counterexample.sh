python3 -I - <<'PY'
from pathlib import Path
from collections import Counter
rows=Path('var/log/app/access.log').read_text().splitlines()
ips=Counter(line.split()[0] for line in rows)
Path('tmp').mkdir(exist_ok=True)
Path('tmp/report.txt').write_text('TOP_IPS\n'+''.join(f'{ip} {n}\n' for ip,n in ips.most_common(10)))
PY
