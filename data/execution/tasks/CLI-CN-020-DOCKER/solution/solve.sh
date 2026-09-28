python3 -I - <<'PY'
from pathlib import Path
import subprocess
Path('build_archive.py').write_text("import gzip, tarfile, io\nfrom pathlib import Path\nwith open('out.tar.gz', 'wb') as raw:\n    with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as gz:\n        with tarfile.open(fileobj=gz, mode='w', format=tarfile.USTAR_FORMAT) as tar:\n            for p in sorted(Path('src').rglob('*'), key=lambda p:p.as_posix()):\n                if not p.is_file(): continue\n                data = p.read_bytes(); info = tarfile.TarInfo(p.as_posix())\n                info.size = len(data); info.mode = 0o644; info.mtime = 0\n                info.uid = info.gid = 0; info.uname = info.gname = ''\n                tar.addfile(info, io.BytesIO(data))")
subprocess.run(['python3', '-I', 'build_archive.py'], check=True)
PY
