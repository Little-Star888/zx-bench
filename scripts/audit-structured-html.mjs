import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// A bounded browser layout audit of saved answers. It does not alter scores.
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const temp = mkdtempSync(join(tmpdir(), 'zxbench-structured-html-'));
const db = new DatabaseSync('apps/data/zxbench.db', { readOnly: true });
const query = db.prepare(`SELECT r.evalRunId,r.modelOutput FROM ScenarioResult r
  JOIN EvalRun e ON e.id=r.evalRunId WHERE e.status='completed'
  AND r.scenarioId=? AND r.modelOutput IS NOT NULL
  ORDER BY e.createdAt DESC LIMIT 6`);
const report = [];
try {
  for (const id of ['SO-CN-019','SO-CN-021','SO-CN-023']) {
    for (const [index,row] of query.all(id).entries()) {
      const nonce = randomBytes(12).toString('base64');
      const source = row.modelOutput.trim().replace(/^```(?:html)?\s*\n/i,'').replace(/\n```\s*$/,'');
      const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'nonce-${nonce}'">`;
      const script = `<script nonce="${nonce}">document.body.setAttribute('data-zx-audit',encodeURIComponent(JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,bodyScroll:document.body.scrollWidth,visibleBars:[...document.querySelectorAll('[class*=bar],[class*=column]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}).length,background:getComputedStyle(document.body).backgroundColor})))</script>`;
      const guarded = /<!doctype html>/i.test(source)
        ? source.replace(/<!doctype html>/i, match => `${match}${csp}`)
        : csp + source;
      const html = /<\/body>/i.test(guarded)
        ? guarded.replace(/<\/body>/i, `${script}</body>`) : guarded + script;
      const path = join(temp,`${id}-${index}.html`);
      writeFileSync(path,html);
      const url = `file:///${path.replaceAll('\\','/')}`;
      const item = { id,runId:row.evalRunId,layout:null,error:null };
      try {
        const dom = execFileSync(chrome,[
          '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
          '--disable-extensions','--disable-background-networking',
          '--host-resolver-rules=MAP * 0.0.0.0',
          '--window-size=512,900','--dump-dom',url],
          {encoding:'utf8',timeout:10000,windowsHide:true,stdio:['ignore','pipe','ignore']});
        const encoded = /data-zx-audit="([^"]+)"/.exec(dom)?.[1];
        if (!encoded) throw new Error('browser audit marker missing');
        item.layout = JSON.parse(decodeURIComponent(encoded.replaceAll('&amp;','&')));
        item.layout.horizontalOverflow = item.layout.scroll > item.layout.width + 2;
      } catch (error) { item.error = String(error.message).slice(0,200); }
      report.push(item);
    }
  }
} finally {
  db.close();
  const resolvedRoot = realpathSync(tmpdir());
  const resolvedTemp = realpathSync(temp);
  if (!resolvedTemp.startsWith(resolvedRoot + sep) ||
      !basename(resolvedTemp).startsWith('zxbench-structured-html-'))
    throw new Error('Refusing to remove unexpected audit directory');
  rmSync(resolvedTemp,{recursive:true,force:true});
}
writeFileSync('data/pilots/structured-html-browser-audit.json',
  JSON.stringify({viewport:'Chrome minimum headless width ~512 CSS px; narrower mobile sizes not measured',results:report},null,2)+'\n');
console.log(JSON.stringify(report.map(x=>({id:x.id,overflow:x.layout?.horizontalOverflow,error:x.error}))));
