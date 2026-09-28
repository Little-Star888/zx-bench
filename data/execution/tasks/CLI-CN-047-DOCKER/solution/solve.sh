python3 -I - <<'PY'
import csv
with open('events.log',newline='') as f: print(len({r[0] for r in csv.reader(f) if r and r[0]}))
PY
