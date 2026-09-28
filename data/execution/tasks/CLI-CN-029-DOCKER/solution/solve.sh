python3 -I - <<'PY'
from pathlib import Path
import tomllib
p=Path('app/config.toml'); p.write_text(p.read_text().replace('[dabatase]','[database]'))
data=tomllib.loads(p.read_text())
assert 'database' in data and 'dabatase' not in data and data['database']['host']=='db.internal'
Path('validation.txt').write_text('exit=0\n')
PY
