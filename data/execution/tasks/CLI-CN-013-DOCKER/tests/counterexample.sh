python3 -I - <<'PY'
from pathlib import Path
rows = Path('sales.csv').read_text().splitlines()[1:]
totals = {}
for row in rows:
    parts = row.split(',')
    if len(parts) != 3: continue
    try: totals[parts[1]] = totals.get(parts[1], 0) + float(parts[2])
    except ValueError: pass
Path('totals.csv').write_text('category,total_usd\n' + ''.join(f'{c},{a:.2f}\n' for c,a in sorted(totals.items(), key=lambda x:-x[1])))
PY
