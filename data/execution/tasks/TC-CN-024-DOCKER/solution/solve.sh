python3 -I - <<'PY'
import subprocess
def git(*args): subprocess.run(['git','-c','safe.directory=/workspace',*args],check=True,stdout=subprocess.DEVNULL)
git('init','-q','-b','main')
git('config','user.name','Bench'); git('config','user.email','bench@example.test')
git('commit','-q','--allow-empty','-m','chore: initialize main')
git('checkout','-q','-b','feature/login')
git('add','.')
git('commit','-q','-m','feat: add login module')
git('checkout','-q','main')
git('merge','-q','feature/login')
print('merged')
PY
