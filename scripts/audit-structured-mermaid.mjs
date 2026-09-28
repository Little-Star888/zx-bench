import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

// Uses a locally installed, pinned Mermaid browser bundle. The bundle is kept
// under ignored logs/ and is not a production dependency.
const runtime = resolve('logs/structured-mermaid-runtime');
const bundle = resolve(runtime,'node_modules/mermaid/dist/mermaid.min.js');
if (!existsSync(bundle)) throw new Error('Install mermaid@11.17.2 in logs/structured-mermaid-runtime first');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const htmlPath = resolve(runtime,'audit.html');
const ids = ['SO-CN-020','SO-CN-022','SO-CN-024','SO-CN-036','SO-CN-037'];
const db = new DatabaseSync('apps/data/zxbench.db',{readOnly:true});
const query = db.prepare(`SELECT r.evalRunId,r.modelOutput FROM ScenarioResult r
  JOIN EvalRun e ON e.id=r.evalRunId WHERE e.status='completed'
  AND r.scenarioId=? AND r.modelOutput IS NOT NULL
  ORDER BY e.createdAt DESC LIMIT 6`);
const inputs = ids.flatMap(id => query.all(id).map((row,index) => ({
  id,runId:row.evalRunId,index,
  source:row.modelOutput.trim().replace(/^```(?:mermaid)?\s*\n/i,'').replace(/\n```\s*$/,''),
})));
db.close();
const safeInputs = JSON.stringify(inputs).replaceAll('<','\\u003c');
const html = `<!doctype html><meta charset="utf-8"><body>
<script src="./node_modules/mermaid/dist/mermaid.min.js"></script>
<script>
(async () => {
  const inputs = ${safeInputs};
  const results = [];
  mermaid.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true});
  for (const item of inputs) {
    const result = {id:item.id,runId:item.runId,index:item.index,
      parsed:false,rendered:false,error:null,svgLength:0};
    try {
      await mermaid.parse(item.source);
      result.parsed = true;
      const output = await mermaid.render('zx_so_' + item.id.replaceAll('-','_') + '_' + item.index,item.source);
      result.rendered = /<svg[\\s>]/i.test(output.svg);
      result.svgLength = output.svg.length;
    } catch (error) { result.error = String(error.message || error).slice(0,500); }
    results.push(result);
  }
  document.body.dataset.zxAudit = encodeURIComponent(JSON.stringify(results));
})().catch(error => { document.body.dataset.zxAuditError = String(error); });
</script></body>`;
writeFileSync(htmlPath,html);
let report;
try {
  const url = `file:///${htmlPath.replaceAll('\\','/')}`;
  const dom = execFileSync(chrome,[
    '--headless=new','--disable-gpu','--allow-file-access-from-files',
    '--disable-extensions','--disable-background-networking',
    '--host-resolver-rules=MAP * 0.0.0.0',
    '--virtual-time-budget=60000','--dump-dom',url],
  {encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,windowsHide:true,
    stdio:['ignore','pipe','ignore']});
  const encoded = /data-zx-audit="([^"]+)"/.exec(dom)?.[1];
  if (!encoded) throw new Error(/data-zx-audit-error="([^"]+)"/.exec(dom)?.[1] || 'Mermaid audit marker missing');
  report = JSON.parse(decodeURIComponent(encoded.replaceAll('&amp;','&')));
} finally {
  if (existsSync(htmlPath)) unlinkSync(htmlPath);
}
writeFileSync('data/pilots/structured-mermaid-render-audit.json',
  JSON.stringify({mermaidVersion:'11.17.2',chrome:'local headless',results:report},null,2)+'\n');
console.log(JSON.stringify(ids.map(id => ({id,
  parsed:report.filter(x=>x.id===id&&x.parsed).length,
  rendered:report.filter(x=>x.id===id&&x.rendered).length,
  count:report.filter(x=>x.id===id).length}))));
