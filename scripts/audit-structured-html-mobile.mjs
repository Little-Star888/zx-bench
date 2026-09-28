import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const temp = mkdtempSync(join(tmpdir(),'zxbench-html-cdp-'));
const child = spawn(chrome,[
  '--headless=new','--remote-debugging-port=0',`--user-data-dir=${join(temp,'profile')}`,
  '--disable-extensions','--disable-background-networking',
  '--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE localhost','about:blank',
],{windowsHide:true,stdio:'ignore'});
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
let socket;
const pending = new Map();
const events = [];
let nextId = 1;
const send = (method,params={}) => new Promise((resolve,reject) => {
  const id=nextId++;
  pending.set(id,{resolve,reject});
  socket.send(JSON.stringify({id,method,params}));
});
const waitEvent = async (method,timeout=5000) => {
  const start=Date.now();
  while(Date.now()-start<timeout) {
    const index=events.findIndex(item=>item.method===method);
    if(index>=0)return events.splice(index,1)[0];
    await delay(25);
  }
  throw new Error(`CDP event timeout: ${method}`);
};
const metric = async () => {
  const response=await send('Runtime.evaluate',{returnByValue:true,
    expression:`JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,
      bodyScroll:document.body?.scrollWidth ?? 0,
      background:getComputedStyle(document.body).backgroundColor})`});
  return JSON.parse(response.result.result.value);
};
const report=[];
try {
  const portFile=join(temp,'profile','DevToolsActivePort');
  for(let i=0;!existsSync(portFile)&&i<100;i++)await delay(100);
  if(!existsSync(portFile))throw new Error('Chrome CDP did not start');
  const port=Number(readFileSync(portFile,'utf8').split(/\r?\n/)[0]);
  const target=await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'}).then(r=>r.json());
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{
    const message=JSON.parse(event.data);
    if(message.id){const task=pending.get(message.id);if(task){pending.delete(message.id);
      message.error?task.reject(new Error(message.error.message)):task.resolve(message);}}
    else if(message.method)events.push(message);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  const db=new DatabaseSync('apps/data/zxbench.db',{readOnly:true});
  const query=db.prepare(`SELECT r.evalRunId,r.modelOutput FROM ScenarioResult r
    JOIN EvalRun e ON e.id=r.evalRunId WHERE e.status='completed'
    AND r.scenarioId=? AND r.modelOutput IS NOT NULL
    ORDER BY e.createdAt DESC LIMIT 6`);
  const inputs=['SO-CN-019','SO-CN-021','SO-CN-023'].flatMap(id=>
    query.all(id).map((row,index)=>({id,index,...row})));
  db.close();
  for(const item of inputs){
    const source=item.modelOutput.trim().replace(/^```(?:html)?\s*\n/i,'').replace(/\n```\s*$/,'');
    const nonce=randomBytes(8).toString('base64');
    const csp=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'nonce-${nonce}'">`;
    const guarded=/<!doctype html>/i.test(source)
      ? source.replace(/<!doctype html>/i,match=>match+csp):csp+source;
    const path=join(temp,`${item.id}-${item.index}.html`);
    writeFileSync(path,guarded);
    const url=`file:///${path.replaceAll('\\','/')}`;
    const measurements={};
    for(const width of [390,1280]){
      await send('Emulation.setDeviceMetricsOverride',{
        width,height:844,deviceScaleFactor:1,mobile:width===390});
      events.length=0;
      await send('Page.navigate',{url});
      await waitEvent('Page.loadEventFired');
      const result=await metric();
      result.targetWidth=width;
      result.horizontalOverflow=result.scroll>width+2;
      measurements[width]=result;
    }
    report.push({id:item.id,runId:item.evalRunId,index:item.index,measurements});
  }
} finally {
  if(socket)socket.close();
  child.kill();
  const root=realpathSync(tmpdir()), resolved=realpathSync(temp);
  if(!resolved.startsWith(root+sep)||!basename(resolved).startsWith('zxbench-html-cdp-'))
    throw new Error('Refusing to remove unexpected audit directory');
  for(let i=0;i<20;i++){try{rmSync(resolved,{recursive:true,force:true});break;}
    catch(error){if(i===19)throw error;await delay(100);}}
}
writeFileSync('data/pilots/structured-html-mobile-audit.json',
  JSON.stringify({browser:'local Chrome CDP',viewports:[390,1280],results:report},null,2)+'\n');
console.log(JSON.stringify(['SO-CN-019','SO-CN-021','SO-CN-023'].map(id=>({id,
  mobileOverflow:report.filter(x=>x.id===id&&x.measurements[390].horizontalOverflow).length,
  desktopOverflow:report.filter(x=>x.id===id&&x.measurements[1280].horizontalOverflow).length,
  count:report.filter(x=>x.id===id).length}))));
