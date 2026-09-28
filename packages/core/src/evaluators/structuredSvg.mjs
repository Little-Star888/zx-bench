// Chromium parses and renders an SVG as an image: scripts in model output never execute.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {randomBytes} from 'node:crypto';
export function renderStructuredSvg(text, contract, chrome) {
  const root=realpathSync(tmpdir()),dir=mkdtempSync(join(root,'zx-contract-svg-'));
  const nonce=randomBytes(16).toString('hex');
  const source=Buffer.from(text).toString('base64');
  const spec=JSON.stringify(contract).replaceAll('<','\\u003c');
  const html=String.raw`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; script-src 'nonce-${nonce}'"><body><script nonce="${nonce}">
  (async()=>{const done=x=>document.body.setAttribute('data-result',encodeURIComponent(JSON.stringify(x)));
  const text=new TextDecoder().decode(Uint8Array.from(atob('${source}'),c=>c.charCodeAt(0))), spec=${spec};
  try {
    if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('DTD forbidden');
    const doc=new DOMParser().parseFromString(text,'image/svg+xml'),svg=doc.documentElement;
    if(doc.querySelector('parsererror')||svg.localName!=='svg'||svg.namespaceURI!=='http://www.w3.org/2000/svg')throw Error('Invalid SVG document');
    const nodes={},numeric=new Set(['x','y','width','height','x1','x2','y1','y2','cx','cy','r']);
    for(const e of doc.querySelectorAll('*')){
      if(['script','foreignObject','image','animate','animateTransform','set'].includes(e.localName))throw Error('Unsupported active/external SVG content');
      for(const a of e.attributes)if(/^on/i.test(a.name)||(/href$/.test(a.name)&&!a.value.startsWith('#'))||/url\((?!\s*#)|@import/i.test(a.value))throw Error('External/active attribute');
      if(e.localName==='style')throw Error('Stylesheets outside published profile');
    }
    for(const item of spec.elements){
      const matches=[...doc.querySelectorAll('[id]')].filter(e=>e.id===item.id);
      if(matches.length!==1)throw Error('Missing/duplicate id '+item.id);
      const e=matches[0],attrs={};
      for(const key of Object.keys(item.attrs??{})){let v=e.getAttribute(key);attrs[key]=v!==null&&numeric.has(key)?Number(v):v;}
      nodes[item.id]={tag:e.localName,attrs,...(item.text!==undefined?{text:e.textContent}:{})};
    }
    const value={width:Number(svg.getAttribute('width')),height:Number(svg.getAttribute('height')),viewBox:svg.getAttribute('viewBox')?.trim().split(/\s+/).map(Number),nodes};
    if(value.width!==spec.width||value.height!==spec.height){done({ok:true,value,rendered:false,samples:[]});return;}
    const image=new Image(),url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml'}));
    image.onload=()=>{try{const c=document.createElement('canvas');c.width=spec.width;c.height=spec.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const samples=spec.samples.map(p=>{const actual=[...ctx.getImageData(p.x,p.y,1,1).data];return {actual,pass:actual.every((v,i)=>Math.abs(v-p.rgba[i])<=8)}});URL.revokeObjectURL(url);done({ok:true,value,rendered:true,samples});}catch(e){done({ok:false,error:String(e)})}};
    image.onerror=()=>done({ok:false,error:'SVG image render failed'});image.src=url;
  }catch(e){done({ok:false,error:String(e)})}
  })();</script></body>`;
  try {
    const path=join(dir,'render.html');writeFileSync(path,html);
    const dom=execFileSync(chrome,['--headless=new','--disable-gpu','--no-first-run','--disable-extensions','--disable-background-networking',
      '--host-resolver-rules=MAP * 0.0.0.0','--virtual-time-budget=3000','--dump-dom',`file:///${path.replaceAll('\\','/')}`],
      {encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024,windowsHide:true,stdio:['ignore','pipe','ignore']});
    const encoded=/data-result="([^"]+)"/.exec(dom)?.[1];
    if(!encoded)throw Error('SVG runtime produced no result');
    return JSON.parse(decodeURIComponent(encoded.replaceAll('&amp;','&')));
  }finally{const resolved=realpathSync(dir);if(!resolved.startsWith(root+sep)||!resolved.split(sep).at(-1).startsWith('zx-contract-svg-'))throw Error('Unexpected temporary path');rmSync(resolved,{recursive:true,force:true});}
}
