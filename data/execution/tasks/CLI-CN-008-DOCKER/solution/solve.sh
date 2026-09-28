python3 - <<'PY'
from pathlib import Path
from datetime import datetime, timedelta
from shutil import move
now = datetime.fromisoformat(Path('.now').read_text().strip().replace('Z', '+00:00')).timestamp()
archive = Path('archive')
for source in Path('in').iterdir():
    if source.is_file() and source.stat().st_mtime < now - timedelta(days=30).total_seconds():
        archive.mkdir(exist_ok=True)
        move(str(source), str(archive / source.name))
PY
