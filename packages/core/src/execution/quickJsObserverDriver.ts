/** Container-side trusted program. NEVER evaluated on the host. Candidate text
 * is passed to a separate WASM context, never Node eval/import/vm. The service
 * context's objects/functions are never handed to candidate code. */
export const QUICKJS_OBSERVER_DRIVER = String.raw`
import {readFileSync} from 'node:fs';
import {newQuickJSWASMModuleFromVariant, newVariant} from '/opt/zx-observer/node_modules/quickjs-emscripten-core/dist/index.mjs';
import variant from '/opt/zx-observer/node_modules/@jitl/quickjs-wasmfile-release-sync/dist/index.mjs';

const request = JSON.parse(readFileSync('/workspace/input.json','utf8'));
const protocol=request.protocol??'quickjs-observation-v1';
if(!['quickjs-observation-v1','quickjs-observation-v2'].includes(protocol))throw Error('Unsupported observation protocol');
const source = readFileSync('/workspace/candidate.js','utf8');
const write = process.stdout.write.bind(process.stdout);
const ascii = v => JSON.stringify(v).replace(/[^\x20-\x7e]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const engine = await newQuickJSWASMModuleFromVariant(newVariant(variant, {
  emscriptenModule: {print:()=>{}, printErr:()=>{}},
}));
const runtime = engine.newRuntime({memoryLimitBytes:32*1024*1024,maxStackSizeBytes:64*1024});
let expired = false;
const deadline = Date.now()+request.budgetMs;
runtime.setInterruptHandler(()=> expired || (expired=Date.now()>deadline));
const checkBudget=()=>{if(expired || Date.now()>deadline){expired=true;throw Error('execution_budget_exceeded');}};
let attemptedImport=false;
// Constant denial only: this callback has no filesystem/network access and
// never returns an object/function handle from the trusted context to guest.
runtime.setModuleLoader(()=>{attemptedImport=true;return {error:new Error('Module imports disabled')};});
// QuickJS modules internally need Promise. We never execute queued jobs and
// reject pending jobs / promise results; this protocol remains synchronous.
const guest = runtime.newContext({intrinsics:{BaseObjects:true,Eval:true,JSON:true,StringNormalize:true,RegExp:true,Promise:true}});
const service = runtime.newContext({intrinsics:{BaseObjects:true,Eval:true,JSON:true,MapSet:true,RegExp:true}});
const retained=[];
const keep=h=>(retained.push(h),h);
const unwrap = r => {
  if (r.error) {r.error.dispose();throw Error(expired?'execution_budget_exceeded':'observer_operation_failed');}
  if(expired || Date.now()>deadline){r.value.dispose();expired=true;throw Error('execution_budget_exceeded');}
  return r.value;
};
const evalOwned = (ctx,src) => keep(unwrap(ctx.evalCode(src,'trusted-bootstrap.js',{type:'global',strict:true})));
const call = (fn,...args) => unwrap(service.callFunction(fn,service.undefined,...args));
const rejectPromise=handle=>{
  const state=guest.getPromiseState(handle);
  if(state.type==='fulfilled'&&state.notAPromise)return;
  // notAPromise borrows the original handle; real results own new handles.
  if(state.type==='fulfilled')state.value.dispose();
  if(state.type==='rejected')state.error.dispose();
  throw Error('async_not_supported');
};
let report;
let phase='bootstrap';
try {
  // These handles never become properties reachable from the candidate.
  const guestObjectProto=evalOwned(guest,'Object.prototype');
  const guestArrayProto=evalOwned(guest,'Array.prototype');
  const guestParse=evalOwned(guest,'JSON.parse');
  const names=['InternalError','RangeError','TypeError','ReferenceError','SyntaxError','URIError','EvalError','Error'];
  const errorProtos=names.map(name=>evalOwned(guest,name+'.prototype'));
  const helpers=evalOwned(service,${JSON.stringify(String.raw`(() => {
    'use strict';
    const desc=Object.getOwnPropertyDescriptor, proto=Object.getPrototypeOf;
    const keys=Reflect.ownKeys, array=Array.isArray, stringify=JSON.stringify;
    const tag=Symbol.toStringTag, tagOf=Function.prototype.call.bind(Object.prototype.toString);
    const own=Function.prototype.call.bind(Object.prototype.hasOwnProperty);
    const encode=v=>stringify(v).replace(/[^\x20-\x7e]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
    function snapshot(value, objectProto, arrayProto) {
      let count=0;const seen=new Set();
      function visit(v,depth) {
        if (++count>10000 || depth>32) throw Error('observation_limit');
        if (v===null || typeof v==='string' || typeof v==='boolean') return v;
        if (typeof v==='number') {
          if (!Number.isFinite(v) || Object.is(v,-0)) throw Error('non_json_number');
          return v;
        }
        if (typeof v!=='object' || seen.has(v)) throw Error('unsupported_or_cyclic_value');
        const arr=array(v),p=proto(v);
        if (arr ? p!==arrayProto : p!==null && p!==objectProto) throw Error('non_plain_value');
        seen.add(v);
        const ks=keys(v);if(ks.length>10000)throw Error('observation_limit');
        let out, len;
        if(arr){const d=desc(v,'length');len=d.value;if(!Number.isSafeInteger(len)||len<0||len>10000)throw Error('array_limit');out=[];}
        else out=Object.create(null);
        let elements=0;
        for(const k of ks){
          if(typeof k!=='string')throw Error('symbol_key');
          if(arr && k==='length')continue;
          const d=desc(v,k);
          if(!d || !own(d,'value') || !d.enumerable)throw Error('accessor_or_non_enumerable');
          if(arr && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k)>=len))throw Error('array_extra_property');
          out[k]=visit(d.value,depth+1);elements++;
        }
        if(arr && elements!==len)throw Error('sparse_array');
        seen.delete(v);return out;
      }
      return encode(visit(value,0));
    }
    function nativeErrorBrand(value){
      if(value===null || typeof value!=='object')return false;
      let p=value,depth=0;
      while(p!==null){
        if(++depth>64 || desc(p,tag))return false;
        p=proto(p);
      }
      return tagOf(value)==='[object Error]';
    }
    // Read the actual thrown value, never evaluate getters or coerce objects.
    // A message is candidate-authored DATA, not trusted error provenance.
    function messageData(value){
      if(value===null||(typeof value!=='object'&&typeof value!=='function'))return encode({kind:'missing'});
      let p=value;
      for(let depth=0;p!==null&&depth<64;depth++,p=proto(p)){
        const d=desc(p,'message');
        if(!d)continue;
        if(!own(d,'value')||typeof d.value!=='string')return encode({kind:'unsupported'});
        return encode({kind:'string',value:d.value});
      }
      return encode({kind:p===null?'missing':'unsupported'});
    }
    return {snapshot,nativeErrorBrand,proto,encode,messageData};
  })()`)});
  const helper=name=>keep(service.getProp(helpers,name));
  const snapshot=helper('snapshot'),brand=helper('nativeErrorBrand'),proto=helper('proto');
  const messageReader=helper('messageData');
  const describe=value=>{
    checkBudget();
    const h=call(snapshot,value,guestObjectProto,guestArrayProto);
    try {return JSON.parse(service.getString(h));} finally {h.dispose();}
  };
  const errorType=error=>{
    const b=call(brand,error);let valid;try {valid=service.eq(b,service.true);} finally {b.dispose();}
    if(!valid)return 'ThrownValue';
    let p=error.dup();
    try {
      for(let depth=0;depth<64&&!service.eq(p,service.null);depth++){
        for(let i=0;i<names.length;i++)if(service.eq(p,errorProtos[i]))return names[i];
        const next=call(proto,p);p.dispose();p=next;
      }
      return 'Error';
    } finally {p.dispose();}
  };
  // Pure guest no-op logging, NOT a callback into the trusted Node observer.
  evalOwned(guest,'globalThis.console={log(){},info(){},warn(){},error(){}}');
  const capabilities=evalOwned(guest,'[typeof Proxy,typeof process,typeof require,typeof fetch].join(",")');
  if(guest.getString(capabilities)!=='undefined,undefined,undefined,undefined')throw Error('unsafe_guest_capabilities');
  // Equality is a native bridge operation, not a guest-supplied boolean.
  const one=keep(guest.newObject()),different=keep(guest.newObject()),alias=keep(one.dup());
  if(!service.eq(one,alias)||service.eq(one,different))throw Error('identity_self_check_failed');
  {
    phase='load';
    const loaded=guest.evalCode(source,'candidate.js',{type:'module',strict:true});
    if(loaded.error){loaded.error.dispose();report={status:expired?'execution_budget_exceeded':'candidate_load_error',observations:[]};}
    else {
      const ns=keep(loaded.value);
      rejectPromise(ns);
      checkBudget();
      if(attemptedImport)throw Error('imports_not_supported');
      if(runtime.hasPendingJob())throw Error('async_not_supported');
      const entry=keep(guest.getProp(ns,'zxEntry'));
      if(guest.typeof(entry)!=='function')throw Error('entrypoint_not_function');
      phase='call';
      const observations=[];
      for(const values of request.calls){
        const argumentsOwned=[];
        try {
          for(const value of values){
            const text=guest.newString(ascii(value));
            try {argumentsOwned.push(unwrap(guest.callFunction(guestParse,guest.undefined,text)));}
            finally {text.dispose();}
          }
          // Retain ORIGINAL argument handles, even if the candidate rebinds locals.
          const r=guest.callFunction(entry,guest.undefined,...argumentsOwned);
          if(Date.now()>deadline)expired=true;
          let observation;
          if(r.error){
            try {
              if(expired)throw Error('execution_budget_exceeded');
              const type=errorType(r.error);
              if(type==='InternalError')throw Error('engine_resource_error');
              observation={kind:'throw',errorType:type};
              if(protocol==='quickjs-observation-v2'){
                const message=call(messageReader,r.error);
                try {observation.message=JSON.parse(service.getString(message));} finally {message.dispose();}
              }
            }
            finally {r.error.dispose();}
          } else {
            try {
              checkBudget();
              rejectPromise(r.value);
              const undefinedValue=service.eq(r.value,service.undefined);
              observation={kind:'return',sameArgument:argumentsOwned.map(a=>service.eq(a,r.value)),valueType:undefinedValue?'undefined':'json'};
              if(!undefinedValue)observation.value=describe(r.value);
            }
            finally {r.value.dispose();}
          }
          observation.argumentsAfter=argumentsOwned.map(describe);
          observations.push(observation);
        } finally {for(const h of argumentsOwned)h.dispose();}
      }
      checkBudget();
      if(attemptedImport)throw Error('imports_not_supported');
      if(runtime.hasPendingJob())throw Error('async_not_supported');
      report={status:'ok',observations};
    }
  }
} catch(error) {
  // Fixed messages only. Never stringify a candidate exception/stack/getter.
  const allowed=['execution_budget_exceeded','engine_resource_error','observer_operation_failed','unsafe_guest_capabilities','identity_self_check_failed','entrypoint_not_function','async_not_supported','imports_not_supported'];
  report={status:expired?'execution_budget_exceeded':allowed.includes(error?.message)?error.message:'observer_rejected',phase,observations:[]};
  if(process.env.ZXB_OBSERVER_DEBUG==='1')process.stderr.write('TRUSTED_DIAGNOSTIC '+String(error?.message));
} finally {
  for(const h of retained.reverse())if(h.alive)h.dispose();
  service.dispose();guest.dispose();
  try {runtime.dispose();} catch {process.stderr.write(JSON.stringify({cleanupFailed:true,report}));throw Error('observer_cleanup_failed');}
}
const output=JSON.stringify({protocol,...report});
if(Buffer.byteLength(output)>65536)throw Error('observation_output_limit');
write(output);
`;
