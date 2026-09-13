/** Bounded Python object/callback observers with host-owned expectations. */
import type{TestDetail}from'@zxbench/types';
import{runInContainer,CONTAINER_IMAGES,type ContainerRunOptions}from'./containerRunner.js';
import{validObservationJson}from'./quickJsObservation.js';
import{validJsonValuePredicate,matchesJsonValuePredicate,type JsonValuePredicate}from'./jsonValuePredicate.js';
import type{JsonValue}from'./isolatedJson.js';
export type PythonJsonAdapter='mutable-default'|'group-by'|'paginate'|'accumulator'|'apply-once'|'topo-order'|'pair-sum'|'fetch-all'|'histogram'|'sql-param'|'path-safe'|'lazy-property'|'shape-sequence';
export interface IsolatedPythonJsonCase{id:string;calls:JsonValue[][];expected:JsonValuePredicate[]}
export interface IsolatedPythonJsonContract{protocol:'isolated-python-json-v1';entrypoint:string;adapter:PythonJsonAdapter;cases:IsolatedPythonJsonCase[]}
const rec=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
export function validIsolatedPythonJsonContract(v:unknown):v is IsolatedPythonJsonContract{if(!rec(v)||v.protocol!=='isolated-python-json-v1'||!['mutable-default','group-by','paginate','accumulator','apply-once','topo-order','pair-sum','fetch-all','histogram','sql-param','path-safe','lazy-property','shape-sequence'].includes(v.adapter as string)||typeof v.entrypoint!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.entrypoint)||!Array.isArray(v.cases)||!v.cases.length||v.cases.length>20)return false;const ids=new Set<string>();return v.cases.every((c:unknown)=>rec(c)&&typeof c.id==='string'&&!ids.has(c.id)&&!!ids.add(c.id)&&Array.isArray(c.calls)&&c.calls.length>0&&c.calls.length<=20&&c.calls.every((x:unknown)=>Array.isArray(x)&&validObservationJson(x)&&Buffer.byteLength(JSON.stringify(x))<65536)&&Array.isArray(c.expected)&&c.expected.length===c.calls.length&&validObservationJson(c.expected)&&c.expected.every(validJsonValuePredicate));}
const driver=`import contextlib,importlib.util,json,sys
request=json.load(open('/workspace/input.json'))
with contextlib.redirect_stdout(sys.stderr):
 spec=importlib.util.spec_from_file_location('candidate','/workspace/candidate.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 out=[]
 for call in request['calls']:
  a=request['adapter']
  if a=='mutable-default':
   if call[0]=='one': out.append(m.add_item(call[1]))
   elif call[0]=='pollution': m.add_item(call[1]);out.append(m.add_item(call[2]))
   else: c=[];out.append(m.add_item(call[1],c) is c)
  elif a=='group-by':
   fn=(lambda x:x%2) if call[0]=='mod2' else len if call[0]=='len' else (lambda x:x);out.append(m.group_by(call[1],fn))
  elif a=='paginate':
   try: out.append({'kind':'return','value':m.paginate(call[0],call[1],call[2])})
   except Exception as e: out.append({'kind':'throw','type':type(e).__name__})
  elif a=='accumulator':
   if call[0]=='independent': x=m.Accumulator();x.add(call[1]);y=m.Accumulator();y.add(call[2]);out.append([x.total(),y.total()])
   else: x=m.Accumulator();[x.add(v) for v in call[1]];out.append(x.total())
  elif a=='apply-once':
   store={};hits=[]
   if call[0]=='repeat':
    fn=lambda:(hits.append(1),call[2])[1];out.append([m.apply_once(call[1],store,fn),m.apply_once(call[1],store,fn),len(hits)])
   else: out.append([m.apply_once('a',store,lambda:call[1]),m.apply_once('b',store,lambda:call[2]),store])
  elif a=='topo-order':
   tasks=call[0]
   try:
    order=m.topo_order(tasks);ok=isinstance(order,list) and len(order)==len(tasks) and len(set(order))==len(tasks) and set(order)==set(tasks) and all(order.index(d)<order.index(n) for n,ds in tasks.items() for d in ds);out.append({'kind':'return','valid':ok})
   except Exception as e: out.append({'kind':'throw','type':type(e).__name__,'message':str(e)})
  elif a=='pair-sum':
   if call[0]=='perf':
    import time;t=time.perf_counter();v=m.has_pair_sum(list(range(call[1])),call[2]);out.append([v,(time.perf_counter()-t)*1000<call[3]])
   else: out.append(m.has_pair_sum(call[0],call[1]))
  elif a=='fetch-all':
   import asyncio
   if call[0]=='values':
    state={'active':0,'peak':0}
    async def fetch(u):
     state['active']+=1;state['peak']=max(state['peak'],state['active']);await asyncio.sleep(.02);state['active']-=1;return 'data:'+u
    m.fetch=fetch;out.append([asyncio.run(m.fetch_all(call[1])),state['peak']])
   elif call[0]=='empty': out.append(asyncio.run(m.fetch_all([])))
   else:
    async def bad(u):
     if u=='b': raise ValueError('boom')
     await asyncio.sleep(0);return 'data:'+u
    m.fetch=bad
    try: asyncio.run(m.fetch_all(['a','b','c']));out.append({'kind':'return'})
    except Exception as e: out.append({'kind':'throw','type':type(e).__name__})
  elif a=='histogram':
   items=list(call[0]);before=list(items);value=m.histogram(items);out.append([value,items==before])
  elif a=='sql-param':
   class Cursor:
    def __init__(self): self.calls=[]
    def execute(self,sql,params=None): self.calls.append([sql,params])
    def fetchall(self): return [('alice',)] if call[0]=='alice' else []
   class Conn:
    def __init__(self): self.c=Cursor()
    def cursor(self): return self.c
   conn=Conn();value=m.find_user(conn,call[0]);sql,params=conn.c.calls[0];out.append([value,sql,params])
  elif a=='path-safe':
   import os,tempfile
   base=tempfile.mkdtemp();open(os.path.join(base,'ok.txt'),'w').write('hello')
   if call[0]=='ok': out.append(m.read_upload(base,'ok.txt'))
   else:
    results=[]
    for name in ['../secret','../../etc/passwd','/etc/passwd']:
     try: m.read_upload(base,name);results.append('return')
     except Exception as e: results.append(type(e).__name__)
    out.append(results)
  elif a=='lazy-property':
   if call[0]=='threads':
    import threading,time
    calls=[0];guard=threading.Lock()
    class Counter:
     @m.LazyProperty
     def value(self):
      with guard:calls[0]+=1
      time.sleep(.02);return {'data':[1,2,3]}
    obj=Counter();barrier=threading.Barrier(20);values=[]
    def work():barrier.wait();values.append(obj.value)
    threads=[threading.Thread(target=work) for _ in range(20)];[t.start() for t in threads];[t.join() for t in threads];out.append([calls[0],len(values),all(v is values[0] for v in values)])
   elif call[0]=='instances':
    a1=m.DataSource();a2=m.DataSource();out.append([a1.expensive_data is a1.expensive_data,a2.expensive_data is a2.expensive_data,a1.expensive_data==a2.expensive_data])
   else:
    x=m.DataSource();v=x.expensive_data;del x.expensive_data;out.append(v==x.expensive_data)
  elif a=='shape-sequence':
   if call[0]=='runtime':out.append([m.total_area([m.Circle(1.0),m.Circle(2.0)]),m.total_area([])])
   else:
    import typing,collections.abc
    try:ann=typing.get_type_hints(m.total_area).get('shapes')
    except Exception:ann=getattr(m.total_area,'__annotations__',{}).get('shapes')
    origin=typing.get_origin(ann);out.append(ann is not None and origin not in (list,set,dict,bytearray,frozenset) and (origin in (collections.abc.Sequence,collections.abc.Iterable,collections.abc.Collection) or any(x in str(ann) for x in ('Sequence','Iterable','Collection'))))
sys.stdout.write(json.dumps(out,ensure_ascii=False,allow_nan=False,separators=(',',':')))`;
export function isolatedPythonOptions(code:string,c:IsolatedPythonJsonContract,calls:JsonValue[][],compileOnly=false):ContainerRunOptions{if(!validIsolatedPythonJsonContract({...c,cases:[{id:'input',calls,expected:calls.map(()=>({equals:null}))}]}))throw Error('Invalid Python observation input');return{image:CONTAINER_IMAGES.python,command:compileOnly?['python','-c',"import ast;ast.parse(open('candidate.py').read())"]:['python','-B','driver.py'],files:compileOnly?[{path:'candidate.py',content:code}]:[{path:'candidate.py',content:code},{path:'driver.py',content:driver},{path:'input.json',content:JSON.stringify({adapter:c.adapter,calls})}],localImageOnly:true,readOnlyRoot:true,readOnly:true,networkDisabled:true,runAsNonRoot:true,memoryMb:128,cpuLimit:1,pidsLimit:32,timeoutMs:5000,maxOutputBytes:65536,env:{HOME:'/tmp'}};}
export async function runIsolatedPythonJsonSuite(code:string,c:IsolatedPythonJsonContract){if(!validIsolatedPythonJsonContract(c))throw Error('Invalid Python observation contract');const syntax=await runInContainer(isolatedPythonOptions(code,c,c.cases[0].calls,true));let infrastructureError=syntax.infrastructureError;const details:TestDetail[]=[];for(const k of c.cases){if(infrastructureError)break;const startedAt=new Date().toISOString(),r=syntax.success?await runInContainer(isolatedPythonOptions(code,c,k.calls)):syntax;infrastructureError=r.infrastructureError;let passed=false;if(r.success&&!r.timedOut&&!r.outputLimitExceeded&&!r.infrastructureError)try{const v:unknown=JSON.parse(r.stdout);passed=Array.isArray(v)&&v.length===k.expected.length&&validObservationJson(v)&&k.expected.every((p,i)=>matchesJsonValuePredicate(v[i],p));}catch{}details.push({testId:k.id,testType:'hidden',passed,stdout:r.stdout,stderr:r.stderr,actualOutput:r.stdout,exitCode:r.exitCode,timedOut:r.timedOut,duration:r.durationMs,startedAt,finishedAt:new Date().toISOString()});}return{compiled:syntax.success,compileError:syntax.success?undefined:syntax.stderr,infrastructureError,details,total:c.cases.length,passed:details.filter(x=>x.passed).length};}
