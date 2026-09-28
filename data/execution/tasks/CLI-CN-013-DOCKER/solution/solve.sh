python3 -I - <<'PY'
import csv
from decimal import Decimal
totals = {}
with open('sales.csv', newline='') as f:
    for r in csv.DictReader(f): totals[r['category']] = totals.get(r['category'], Decimal(0)) + Decimal(r['amount_usd'])
with open('totals.csv', 'w', newline='') as f:
    w = csv.writer(f, lineterminator='\n'); w.writerow(['category', 'total_usd'])
    for c, amount in sorted(totals.items(), key=lambda x: (-x[1], x[0])): w.writerow([c, format(amount, '.2f')])
PY
