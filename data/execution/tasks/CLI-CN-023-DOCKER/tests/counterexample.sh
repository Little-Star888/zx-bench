python3 -I - <<'PY'
import tarfile, io, copy
with tarfile.open('archive.tar', 'r:') as source, tarfile.open('new.tar', 'w', format=tarfile.USTAR_FORMAT) as target:
    for old in sorted(source.getmembers(), key=lambda m:m.name):
        data = source.extractfile(old).read()
        if old.name == 'config.ini': data = b'mode=prod\n'
        info = copy.copy(old); info.size = len(data); target.addfile(info, io.BytesIO(data))
PY
