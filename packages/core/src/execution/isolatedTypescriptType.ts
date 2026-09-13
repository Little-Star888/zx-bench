/** Bounded trusted compiler observation. Candidate text is parsed/type-checked, never executed. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { TestDetail } from '@zxbench/types';

export interface IsolatedTypescriptTypeCase { id:string; description:string; kind:'positive'|'negative'; code:string }
export interface IsolatedTypescriptTypeContract { protocol:'isolated-typescript-type-v1'; entrypoint:string; cases:IsolatedTypescriptTypeCase[] }
const rec=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
export function validIsolatedTypescriptTypeContract(v:unknown):v is IsolatedTypescriptTypeContract {
 if(!rec(v)||v.protocol!=='isolated-typescript-type-v1'||typeof v.entrypoint!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.entrypoint)||!Array.isArray(v.cases)||!v.cases.length||v.cases.length>20)return false;
 const ids=new Set<string>();return v.cases.every((c:unknown)=>rec(c)&&typeof c.id==='string'&&c.id.length<=120&&!ids.has(c.id)&&!!ids.add(c.id)&&typeof c.description==='string'&&typeof c.code==='string'&&c.code.length<=10000&&['positive','negative'].includes(c.kind as string));
}
export async function runIsolatedTypescriptTypeSuite(solution:string,contract:IsolatedTypescriptTypeContract){
 if(!validIsolatedTypescriptTypeContract(contract))throw Error('Invalid TypeScript type contract');
 if(solution.length>200000)return{compiled:false,compileError:'candidate exceeds 200000 bytes',details:[],total:contract.cases.length,passed:0};
 const compiledWorker=fileURLToPath(new URL('./typescriptTypeWorker.js',import.meta.url));
 const worker=existsSync(compiledWorker)?compiledWorker:fileURLToPath(new URL('./typescriptTypeWorker.ts',import.meta.url)),started=Date.now();
 return await new Promise<{compiled:boolean;compileError?:string;infrastructureError?:string;details:TestDetail[];total:number;passed:number}>(resolve=>{
  const child=spawn(process.execPath,['--max-old-space-size=128',...(worker.endsWith('.ts')?['--experimental-strip-types']:[]),worker],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{PATH:process.env.PATH??''}});let out='',err='',settled=false;
  const finish=(r:Parameters<typeof resolve>[0])=>{if(settled)return;settled=true;clearTimeout(timer);resolve(r)};
  child.stdout.setEncoding('utf8').on('data',c=>{out+=c;if(out.length>262144)child.kill()});child.stderr.setEncoding('utf8').on('data',c=>{err+=c;if(err.length>262144)child.kill()});
  const timer=setTimeout(()=>{child.kill();finish({compiled:false,infrastructureError:'TypeScript compiler worker timeout',details:[],total:contract.cases.length,passed:0})},10000);
  child.on('error',e=>finish({compiled:false,infrastructureError:e.message,details:[],total:contract.cases.length,passed:0}));
  child.on('close',code=>{if(settled)return;if(code!==0)return finish({compiled:false,infrastructureError:'TypeScript compiler worker failed: '+err.slice(0,300),details:[],total:contract.cases.length,passed:0});try{const parsed=JSON.parse(out)as{compileErrors:string[];cases:{id:string;errors:string[];passed:boolean}[]},now=new Date().toISOString();const details:TestDetail[]=contract.cases.map(c=>{const r=parsed.cases.find(x=>x.id===c.id);return{testId:c.id,testType:c.kind==='positive'?'type_positive':'type_negative',name:c.description,passed:r?.passed===true,actual:r?.errors.length?r.errors.join(' | '):'(no type errors)',expected:c.kind==='positive'?'no type errors':'type error expected',duration:Date.now()-started,timedOut:false,startedAt:now,finishedAt:new Date().toISOString()}});finish({compiled:parsed.compileErrors.length===0,compileError:parsed.compileErrors.join(' | ')||undefined,details,total:details.length,passed:details.filter(x=>x.passed).length})}catch{finish({compiled:false,infrastructureError:'Invalid TypeScript compiler worker output',details:[],total:contract.cases.length,passed:0})}});
  child.stdin.end(JSON.stringify({solution,cases:contract.cases.map(({id,kind,code})=>({id,kind,code}))}));
 });
}
