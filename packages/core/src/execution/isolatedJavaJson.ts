/** Adapter-bounded Java observations: candidate receives inputs, never expectations or verdicts. */
import type { TestDetail } from '@zxbench/types';
import { runInContainer, type ContainerRunOptions } from './containerRunner.js';
import { validObservationJson } from './quickJsObservation.js';
import { validJsonValuePredicate, matchesJsonValuePredicate, type JsonValuePredicate } from './jsonValuePredicate.js';
import type { JsonValue } from './isolatedJson.js';

export type JavaJsonAdapter='int-array-average'|'money-equality'|'boxed-integer-equality'|'decimal-ledger'|'strict-date'|'file-first-line'|'cache-compute'|'singleton-publication'|'squares-stress'|'schema-cache-lifecycle';
export interface IsolatedJavaJsonCase {id:string;calls:JsonValue[][];expected:JsonValuePredicate[];}
export interface IsolatedJavaJsonContract {protocol:'isolated-java-json-v1'|'isolated-java-json-v2';entrypoint:string;adapter:JavaJsonAdapter;cases:IsolatedJavaJsonCase[];}
export const JAVA_JSON_IMAGE='maven@sha256:c7baad7b0d2c869227cda4a574cb4b218781c80632bb5afce2282db8e5f7f0bc';
const record=(v:unknown):v is Record<string,any>=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const int=(v:unknown)=>Number.isInteger(v)&&Number(v)>=-2147483648&&Number(v)<=2147483647;
const str=(v:unknown,max=256)=>typeof v==='string'&&v.length<=max;
function validCall(adapter:JavaJsonAdapter,args:unknown[]):boolean {
  if(adapter==='int-array-average')return args.length===1&&Array.isArray(args[0])&&args[0].length>0&&args[0].length<=1000&&args[0].every(int);
  if(adapter==='money-equality')return args.length===3&&['setSize','hashEqual'].includes(args[2] as string)
    &&[args[0],args[1]].every(v=>Array.isArray(v)&&v.length===2&&Number.isSafeInteger(v[0])&&str(v[1],32));
  if(adapter==='boxed-integer-equality')return args.length===3&&int(args[0])&&int(args[1])&&['auto','fresh'].includes(args[2] as string);
  if(adapter==='decimal-ledger')return args.length===2&&Array.isArray(args[0])&&args[0].length<=100&&args[0].every(v=>str(v,64)&&/^-?[0-9]+(?:\.[0-9]+)?$/.test(v as string))
    &&str(args[1],64)&&/^-?[0-9]+(?:\.[0-9]+)?$/.test(args[1] as string);
  if(adapter==='strict-date')return args.length===1&&str(args[0],64);
  if(adapter==='file-first-line')return args.length===3&&str(args[0],4096)&&['content','leak'].includes(args[1] as string)&&int(args[2])&&Number(args[2])>=1&&Number(args[2])<=500;
  if(adapter==='cache-compute')return args.length===2&&int(args[0])&&Number(args[0])>=1&&Number(args[0])<=64&&['serial','calls','value'].includes(args[1] as string);
  if(adapter==='singleton-publication')return args.length===2&&int(args[0])&&Number(args[0])>=1&&Number(args[0])<=128&&['get','identity','volatile','reset'].includes(args[1] as string);
  if(adapter==='squares-stress')return args.length===3&&int(args[0])&&Number(args[0])>=0&&Number(args[0])<=2000000&&int(args[1])&&Number(args[1])>=1&&Number(args[1])<=20&&['values','stable','unique','perf'].includes(args[2] as string);
  return adapter==='schema-cache-lifecycle'&&args.length===3&&int(args[0])&&Number(args[0])>=1&&Number(args[0])<=32&&int(args[1])&&Number(args[1])>=1&&Number(args[1])<=200&&['hit','weak','unload','concurrent','threadlocal'].includes(args[2] as string);
}
export function validIsolatedJavaJsonContract(v:unknown):v is IsolatedJavaJsonContract {
  const advanced=['file-first-line','cache-compute','singleton-publication','squares-stress','schema-cache-lifecycle'];
  if(!record(v)||!['isolated-java-json-v1','isolated-java-json-v2'].includes(v.protocol)||!['int-array-average','money-equality','boxed-integer-equality','decimal-ledger','strict-date',...advanced].includes(v.adapter)
    ||((v.protocol==='isolated-java-json-v2')!==advanced.includes(v.adapter))
    ||typeof v.entrypoint!=='string'||!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(v.entrypoint)||!Array.isArray(v.cases)||!v.cases.length||v.cases.length>100)return false;
  const ids=new Set<string>();
  return v.cases.every((c:unknown)=>record(c)&&typeof c.id==='string'&&c.id.length>0&&!ids.has(c.id)&&ids.add(c.id)
    &&Array.isArray(c.calls)&&c.calls.length>0&&c.calls.length<=100&&c.calls.every((a:unknown)=>Array.isArray(a)&&validObservationJson(a)&&validCall(v.adapter,a))
    &&Array.isArray(c.expected)&&c.expected.length===c.calls.length&&validObservationJson(c.expected)&&c.expected.every(validJsonValuePredicate));
}
const javaString=(v:string)=>JSON.stringify(v).replace(/\u2028|\u2029/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
function candidateSource(code:string,adapter:JavaJsonAdapter):string {
  const clean=code.trim().replace(/\bpublic\s+(class|interface|enum)\b/g,'$1');
  const body=['money-equality','cache-compute','singleton-publication','squares-stress','schema-cache-lifecycle'].includes(adapter)?clean:`class Candidate {\n${clean}\n}`;
  return `import java.io.*;\nimport java.util.*;\n${body}`;
}
function callSource(adapter:JavaJsonAdapter,entrypoint:string,args:JsonValue[],i:number):string {
  if(adapter==='int-array-average')return `double v${i}=Candidate.${entrypoint}(new int[]{${(args[0] as number[]).join(',')}}); add(out,Double.isFinite(v${i})?Double.toString(v${i}):"NON_FINITE");`;
  if(adapter==='money-equality'){
    const [a,b,action]=args as [[number,string],[number,string],string];
    const x=`new ${entrypoint}(${a[0]}L,${javaString(a[1])})`,y=`new ${entrypoint}(${b[0]}L,${javaString(b[1])})`;
    return action==='setSize'?`java.util.Set<${entrypoint}> s${i}=new java.util.HashSet<>();s${i}.add(${x});s${i}.add(${y});add(out,Integer.toString(s${i}.size()));`
      :`add(out,Boolean.toString((${x}).hashCode()==(${y}).hashCode()));`;
  }
  if(adapter==='boxed-integer-equality'){
    const [a,b,mode]=args as [number,number,string];
    const x=mode==='fresh'?`new Integer(${a})`:`Integer.valueOf(${a})`,y=mode==='fresh'?`new Integer(${b})`:`Integer.valueOf(${b})`;
    return `add(out,Boolean.toString(Candidate.${entrypoint}(${x},${y})));`;
  }
  if(adapter==='decimal-ledger'){
    const [values,amount]=args as [string[],string];
    return `add(out,Boolean.toString(Candidate.${entrypoint}(java.util.Arrays.asList(${values.map(v=>`new java.math.BigDecimal(${javaString(v)})`).join(',')}),new java.math.BigDecimal(${javaString(amount)}))));`;
  }
  if(adapter==='strict-date')return `String v${i}=Candidate.${entrypoint}(${javaString(args[0] as string)});add(out,v${i}==null?"null":"\\\""+v${i}+"\\\"");`;
  if(adapter==='file-first-line'){
    const [content,mode,repeats]=args as [string,string,number];
    if(mode==='content')return `try{java.nio.file.Path p${i}=java.nio.file.Files.createTempFile("zx", ".txt");java.nio.file.Files.writeString(p${i},${javaString(content)});String v${i}=Candidate.${entrypoint}(p${i}.toString());java.nio.file.Files.deleteIfExists(p${i});add(out,v${i}==null?"null":"\\\""+v${i}+"\\\"");}catch(Exception e){add(out,"\\\"ERROR\\\"");}`;
    return `int b${i}=fds();for(int j=0;j<${repeats};j++)try{Candidate.${entrypoint}("/proc/self/mem");}catch(Exception ignored){}int a${i}=fds();add(out,Boolean.toString(a${i}-b${i}<=10));`;
  }
  if(adapter==='cache-compute'){
    const [threads,action]=args as [number,string];
    if(action==='serial')return `Cache c${i}=new Cache();java.util.concurrent.atomic.AtomicInteger n${i}=new java.util.concurrent.atomic.AtomicInteger();java.util.function.Supplier<Integer>s${i}=()->{n${i}.incrementAndGet();return 42;};int x${i}=c${i}.getOrCompute("a",s${i});int y${i}=c${i}.getOrCompute("a",s${i});add(out,"["+n${i}.get()+","+y${i}+"]");`;
    return `Cache c${i}=new Cache();java.util.concurrent.atomic.AtomicInteger n${i}=new java.util.concurrent.atomic.AtomicInteger();java.util.concurrent.CountDownLatch start${i}=new java.util.concurrent.CountDownLatch(1);Thread[] ts${i}=new Thread[${threads}];for(int j=0;j<ts${i}.length;j++)ts${i}[j]=new Thread(()->{try{start${i}.await();}catch(Exception e){}c${i}.getOrCompute("k",()->{n${i}.incrementAndGet();try{Thread.sleep(20);}catch(Exception e){}return 99;});});for(Thread t:ts${i})t.start();start${i}.countDown();for(Thread t:ts${i})try{t.join();}catch(Exception e){}add(out,${action==='calls'?`Integer.toString(n${i}.get())`:`Integer.toString(c${i}.getOrCompute("k",()->99))`});`;
  }
  if(adapter==='singleton-publication'){
    const [threads,action]=args as [number,string];
    if(action==='volatile')return `try{add(out,Boolean.toString(java.lang.reflect.Modifier.isVolatile(ConfigHolder.class.getDeclaredField("instance").getModifiers())));}catch(Exception e){add(out,"false");}`;
    if(action==='get')return `add(out,"\\\""+ConfigHolder.getInstance().get("env")+"\\\"");`;
    if(action==='reset')return `try{java.lang.reflect.Field f${i}=ConfigHolder.class.getDeclaredField("instance");f${i}.setAccessible(true);f${i}.set(null,null);add(out,"\\\""+ConfigHolder.getInstance().get("env")+"\\\"");}catch(Exception e){add(out,"null");}`;
    return `try{java.lang.reflect.Field f${i}=ConfigHolder.class.getDeclaredField("instance");f${i}.setAccessible(true);f${i}.set(null,null);java.util.Set<ConfigHolder>s${i}=java.util.Collections.synchronizedSet(java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>()));java.util.concurrent.CountDownLatch l${i}=new java.util.concurrent.CountDownLatch(1);Thread[]ts${i}=new Thread[${threads}];for(int j=0;j<ts${i}.length;j++)ts${i}[j]=new Thread(()->{try{l${i}.await();}catch(Exception e){}s${i}.add(ConfigHolder.getInstance());});for(Thread t:ts${i})t.start();l${i}.countDown();for(Thread t:ts${i})t.join();add(out,Integer.toString(s${i}.size()));}catch(Exception e){add(out,"-1");}`;
  }
  if(adapter==='squares-stress'){
    const [n,repeats,mode]=args as [number,number,string];
    if(mode==='values')return `add(out,jsonInts(Squares.squares(${n})));`;
    if(mode==='stable')return `java.util.List<Integer> q${i}=Squares.squares(${n});boolean z${i}=ascending(q${i});for(int j=1;j<${repeats};j++)z${i}&=q${i}.equals(Squares.squares(${n}));add(out,"["+q${i}.size()+","+z${i}+"]");`;
    if(mode==='unique')return `java.util.List<Integer> q${i}=Squares.squares(${n});add(out,"["+q${i}.size()+","+(new java.util.HashSet<Integer>(q${i}).size()==${n})+"]");`;
    return `long b${i}=System.nanoTime();java.util.List<Integer>q${i}=Squares.squares(${n});long ms${i}=(System.nanoTime()-b${i})/1000000L;add(out,"["+q${i}.size()+","+(ms${i}<=15000)+"]");`;
  }
  const [threads,loops,action]=args as [number,number,string];
  if(action==='weak')return `try{java.lang.reflect.Field f${i}=SchemaCache.class.getDeclaredField("CACHE");f${i}.setAccessible(true);String g${i}=f${i}.getGenericType().getTypeName();add(out,Boolean.toString(f${i}.get(null) instanceof java.util.WeakHashMap&&g${i}.contains("ClassLoader")&&g${i}.contains("WeakReference")));}catch(Throwable e){add(out,"false");}`;
  if(action==='hit')return `try{Class<?>a${i}=SchemaCache.load("java.util.ArrayList");Class<?>b${i}=SchemaCache.load("java.util.ArrayList");add(out,Boolean.toString(a${i}==b${i}));}catch(Exception e){add(out,"false");}`;
  if(action==='unload')return `try{SchemaCache.load("java.lang.String");SchemaCache.unload();SchemaCache.unload();SchemaCache.unload();add(out,Boolean.toString(SchemaCache.load("java.lang.String")==String.class));}catch(Throwable e){add(out,"false");}`;
  if(action==='threadlocal')return `try{java.lang.reflect.Field f${i}=SchemaCache.class.getDeclaredField("SCRATCH");f${i}.setAccessible(true);ThreadLocal<?>t${i}=(ThreadLocal<?>)f${i}.get(null);SchemaCache.load("java.util.ArrayList");Object b${i}=t${i}.get();SchemaCache.unload();Object a${i}=t${i}.get();add(out,Boolean.toString(b${i}!=null&&a${i}==null));}catch(Throwable e){add(out,"false");}`;
  return `java.util.concurrent.atomic.AtomicReference<Throwable>er${i}=new java.util.concurrent.atomic.AtomicReference<>();Thread[]ts${i}=new Thread[${threads}];for(int j=0;j<ts${i}.length;j++)ts${i}[j]=new Thread(()->{try{for(int k=0;k<${loops};k++){SchemaCache.load("java.util.ArrayList");if(k%20==0)SchemaCache.unload();}}catch(Throwable t){er${i}.compareAndSet(null,t);}});for(Thread t:ts${i})t.start();for(Thread t:ts${i})try{t.join();}catch(Exception e){}add(out,Boolean.toString(er${i}.get()==null));`;
}
function driverSource(contract:IsolatedJavaJsonContract,calls:JsonValue[][]):string {
  return `class Driver {static boolean first=true;static void add(StringBuilder b,String v){if(!first)b.append(',');first=false;b.append(v);}static int fds(){String[]x=new java.io.File("/proc/self/fd").list();return x==null?-1:x.length;}static boolean ascending(java.util.List<Integer>x){for(int i=1;i<x.size();i++)if(x.get(i)<x.get(i-1))return false;return true;}static String jsonInts(java.util.List<Integer>x){StringBuilder b=new StringBuilder("[");for(int i=0;i<x.size();i++){if(i>0)b.append(',');b.append(x.get(i));}return b.append(']').toString();}public static void main(String[]x){StringBuilder out=new StringBuilder("[");${calls.map((a,i)=>callSource(contract.adapter,contract.entrypoint,a,i)).join('\n')}System.out.print(out.append(']'));}}`;
}
export function isolatedJavaOptions(code:string,contract:IsolatedJavaJsonContract,calls:JsonValue[][],compileOnly=false):ContainerRunOptions {
  if(!validIsolatedJavaJsonContract({...contract,cases:[{id:'input',calls,expected:calls.map(()=>({equals:null}))}]}))throw Error('Invalid Java observation input');
  const advanced=contract.protocol==='isolated-java-json-v2';
  return {image:JAVA_JSON_IMAGE,command:['sh','-c',`mkdir -p /tmp/classes && javac -d /tmp/classes Candidate.java Driver.java${compileOnly?'':' && java -Dfile.encoding=UTF-8 -cp /tmp/classes Driver'}`],
    files:[{path:'Candidate.java',content:candidateSource(code,contract.adapter)},{path:'Driver.java',content:driverSource(contract,calls)}],
    localImageOnly:true,readOnlyRoot:true,readOnly:true,networkDisabled:true,runAsNonRoot:true,memoryMb:advanced?512:384,cpuLimit:1,pidsLimit:advanced?192:64,timeoutMs:advanced?25000:8000,maxOutputBytes:65536,
    env:{HOME:'/tmp',TMPDIR:'/tmp',MAVEN_CONFIG:'/tmp/.m2'},};
}
export async function runIsolatedJavaJsonSuite(code:string,contract:IsolatedJavaJsonContract){
  if(!validIsolatedJavaJsonContract(contract))throw Error('Invalid Java observation contract');
  const syntax=await runInContainer(isolatedJavaOptions(code,contract,contract.cases[0].calls,true));
  let infrastructureError=syntax.infrastructureError;const details:TestDetail[]=[];
  for(const c of contract.cases){if(infrastructureError)break;const startedAt=new Date().toISOString();const r=syntax.success?await runInContainer(isolatedJavaOptions(code,contract,c.calls)):syntax;
    infrastructureError=r.infrastructureError;let passed=false;
    if(r.success&&!r.timedOut&&!r.outputLimitExceeded&&!r.infrastructureError)try{const values:unknown=JSON.parse(r.stdout);passed=Array.isArray(values)&&values.length===c.expected.length&&validObservationJson(values)&&c.expected.every((p,i)=>matchesJsonValuePredicate(values[i],p));}catch{}
    details.push({testId:c.id,testType:'hidden',passed,stdout:r.stdout,stderr:r.stderr,actualOutput:r.stdout,exitCode:r.exitCode,timedOut:r.timedOut,duration:r.durationMs,startedAt,finishedAt:new Date().toISOString()});}
  return {compiled:syntax.success,compileError:syntax.success?undefined:syntax.stderr,infrastructureError,details,total:contract.cases.length,passed:details.filter(t=>t.passed).length};
}
