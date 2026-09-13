/** Adapter-bounded C# observations: candidate receives inputs, never expectations or verdicts. */
import type { TestDetail } from '@zxbench/types';
import { runInContainer, type ContainerRunOptions } from './containerRunner.js';
import { validObservationJson } from './quickJsObservation.js';
import { validJsonValuePredicate, matchesJsonValuePredicate, type JsonValuePredicate } from './jsonValuePredicate.js';
import type { JsonValue } from './isolatedJson.js';

export type CsharpJsonAdapter='counter-delegates'|'decimal-round'|'metrics-record'|'money-equality'|'decimal-sum'|'report-sync-context'|'header-span';
export interface IsolatedCsharpJsonCase {id:string;calls:JsonValue[][];expected:JsonValuePredicate[];}
export interface IsolatedCsharpJsonContract {protocol:'isolated-csharp-json-v1'|'isolated-csharp-json-v2';entrypoint:string;adapter:CsharpJsonAdapter;cases:IsolatedCsharpJsonCase[];}
export const CSHARP_JSON_IMAGE='mcr.microsoft.com/dotnet/sdk@sha256:8a80a27ddac789b4cb6d09d244f9c8d840da599c5ad22f7233c04be470e55261';
const record=(v:unknown):v is Record<string,any>=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const int=(v:unknown,min=0,max=1000)=>Number.isInteger(v)&&Number(v)>=min&&Number(v)<=max;
const str=(v:unknown,max=64)=>typeof v==='string'&&v.length<=max;
const decimal=(v:unknown)=>str(v)&&/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(v as string);
function validCall(adapter:CsharpJsonAdapter,args:unknown[]):boolean {
  if(adapter==='counter-delegates')return args.length===2&&int(args[0],1,1000)&&['count','values'].includes(args[1] as string);
  if(adapter==='decimal-round')return args.length===1&&decimal(args[0]);
  if(adapter==='metrics-record')return args.length===1&&int(args[0],0,1000);
  if(adapter==='money-equality')return args.length===3&&['singleSize','setSize','contains'].includes(args[2] as string)
    &&[args[0],args[1]].every(v=>Array.isArray(v)&&v.length===2&&decimal(v[0])&&str(v[1],32));
  if(adapter==='decimal-sum')return args.length===2&&Array.isArray(args[0])&&args[0].length<=100&&args[0].every(decimal)&&int(args[1],1,1000);
  if(adapter==='report-sync-context')return args.length===5&&[200,404].includes(args[0] as number)&&str(args[1],64)&&int(args[2],0,500)&&['report','plain','http-error','repeat'].includes(args[3] as string)&&int(args[4],1,3);
  return adapter==='header-span'&&args.length===3&&str(args[0],1024)&&['pair','valid','key','alloc'].includes(args[1] as string)&&int(args[2],1,100000);
}
export function validIsolatedCsharpJsonContract(v:unknown):v is IsolatedCsharpJsonContract {
  const advanced=['report-sync-context','header-span'];
  if(!record(v)||!['isolated-csharp-json-v1','isolated-csharp-json-v2'].includes(v.protocol)||!['counter-delegates','decimal-round','metrics-record','money-equality','decimal-sum',...advanced].includes(v.adapter)
    ||((v.protocol==='isolated-csharp-json-v2')!==advanced.includes(v.adapter))
    ||typeof v.entrypoint!=='string'||!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(v.entrypoint)||!Array.isArray(v.cases)||!v.cases.length||v.cases.length>100)return false;
  const ids=new Set<string>();
  return v.cases.every((c:unknown)=>record(c)&&typeof c.id==='string'&&c.id.length>0&&!ids.has(c.id)&&ids.add(c.id)
    &&Array.isArray(c.calls)&&c.calls.length>0&&c.calls.length<=100&&c.calls.every((a:unknown)=>Array.isArray(a)&&validObservationJson(a)&&validCall(v.adapter,a))
    &&Array.isArray(c.expected)&&c.expected.length===c.calls.length&&validObservationJson(c.expected)&&c.expected.every(validJsonValuePredicate));
}
const csString=(v:string)=>JSON.stringify(v);
function candidateSource(code:string,adapter:CsharpJsonAdapter):string {
  const clean=code.trim();
  const body=['counter-delegates','decimal-round','decimal-sum'].includes(adapter)?`public static class Candidate {\n${clean}\n}`:clean;
  return `using System;\nusing System.Collections.Generic;\nusing System.Net.Http;\nusing System.Threading;\nusing System.Threading.Tasks;\n${body}`;
}
function callSource(adapter:CsharpJsonAdapter,entrypoint:string,args:JsonValue[],i:number):string {
  if(adapter==='counter-delegates')return args[1]==='count'
    ?`Add(Candidate.${entrypoint}(${args[0]}).Count);`
    :`var c${i}=Candidate.${entrypoint}(${args[0]});var a${i}=new int[c${i}.Count];for(int j=0;j<c${i}.Count;j++)a${i}[j]=c${i}[j]();Add(a${i});`;
  if(adapter==='decimal-round')return `Add(Candidate.${entrypoint}(decimal.Parse(${csString(args[0] as string)},CultureInfo.InvariantCulture)).ToString("G29",CultureInfo.InvariantCulture));`;
  if(adapter==='metrics-record')return `var m${i}=new Metrics();for(int j=0;j<${args[0]};j++)m${i}.Record();Add(m${i}.Total.Value);`;
  if(adapter==='money-equality'){
    const [a,b,action]=args as [[string,string],[string,string],string];
    const x=`new ${entrypoint}{Amount=decimal.Parse(${csString(a[0])},CultureInfo.InvariantCulture),Currency=${csString(a[1])}}`;
    const y=`new ${entrypoint}{Amount=decimal.Parse(${csString(b[0])},CultureInfo.InvariantCulture),Currency=${csString(b[1])}}`;
    return action==='singleSize'?`var s${i}=new HashSet<${entrypoint}>();s${i}.Add(${x});Add(s${i}.Count);`
      :action==='setSize'?`var s${i}=new HashSet<${entrypoint}>();s${i}.Add(${x});s${i}.Add(${y});Add(s${i}.Count);`
      :`var s${i}=new HashSet<${entrypoint}>();s${i}.Add(${x});Add(s${i}.Contains(${y}));`;
  }
  if(adapter==='report-sync-context'){
    const [status,body,delay,action,repeats]=args as [number,string,number,string,number];
    return `using(var server${i}=new TinyServer(${status},${csString(body)},${delay},${repeats})){object? value${i}=null;var done${i}=new ManualResetEventSlim(false);var t${i}=new Thread(()=>{SynchronizationContext.SetSynchronizationContext(${action==='plain'?'null':'new DropSyncContext()'});try{var svc=new ReportService();${action==='http-error'?`try{svc.GetReport(server${i}.Url);value${i}=false;}catch(Exception e){value${i}=e is HttpRequestException;}`:action==='repeat'?`int n=0;for(int j=0;j<${repeats};j++)if(svc.GetReport(server${i}.Url)==${csString(body.toUpperCase())})n++;value${i}=n;`:`value${i}=svc.GetReport(server${i}.Url);`}}catch{value${i}=${action==='http-error'?'false':'null'};}finally{done${i}.Set();}});t${i}.IsBackground=true;t${i}.Start();if(!done${i}.Wait(${action==='repeat'?6000:3000}))value${i}=${action==='http-error'?'false':'null'};Add(value${i});}`;
  }
  if(adapter==='header-span'){
    const [header,action,repeats]=args as [string,string,number];
    if(action==='alloc')return `HeaderParser.TryGetKey(${csString(header)}.AsSpan(),out _);long b${i}=GC.GetAllocatedBytesForCurrentThread();for(int j=0;j<${repeats};j++)HeaderParser.TryGetKey(${csString(header)}.AsSpan(),out _);Add(GC.GetAllocatedBytesForCurrentThread()-b${i}<=1024);`;
    return `bool ok${i}=HeaderParser.TryGetKey(${csString(header)}.AsSpan(),out var k${i});${action==='pair'?`Add(new object[]{ok${i},k${i}.ToString()});`:action==='valid'?`Add(ok${i});`:`Add(k${i}.ToString());`}`;
  }
  const [values,repeat]=args as [string[],number];
  return `var p${i}=new List<double>();for(int j=0;j<${repeat};j++){${values.map(v=>`p${i}.Add(double.Parse(${csString(v)},CultureInfo.InvariantCulture));`).join('')}}var v${i}=Candidate.${entrypoint}(p${i}.ToArray());Add(((decimal)v${i}).ToString("G29",CultureInfo.InvariantCulture));`;
}
function driverSource(contract:IsolatedCsharpJsonContract,calls:JsonValue[][]):string {
  const helpers=contract.adapter==='report-sync-context'?`sealed class DropSyncContext:SynchronizationContext{public override void Post(SendOrPostCallback d,object? state){}}\nsealed class TinyServer:IDisposable{readonly System.Net.Sockets.TcpListener listener;readonly int status,delay,count;readonly string body;public string Url{get;}public TinyServer(int status,string body,int delay,int count){this.status=status;this.body=body;this.delay=delay;this.count=count;listener=new(System.Net.IPAddress.Loopback,0);listener.Start();Url="http://127.0.0.1:"+((System.Net.IPEndPoint)listener.LocalEndpoint).Port+"/";var t=new Thread(Run){IsBackground=true};t.Start();}void Run(){try{for(int i=0;i<count;i++){using var c=listener.AcceptTcpClient();using var s=c.GetStream();var buf=new byte[8192];s.Read(buf);Thread.Sleep(delay);var bytes=System.Text.Encoding.UTF8.GetBytes(body);var reason=status==200?"OK":"Not Found";var head=System.Text.Encoding.ASCII.GetBytes($"HTTP/1.1 {status} {reason}\\r\\nContent-Length: {bytes.Length}\\r\\nConnection: close\\r\\n\\r\\n");s.Write(head);s.Write(bytes);}}catch{}}public void Dispose(){listener.Stop();}}\n`:'';
  return `using System;\nusing System.Collections.Generic;\nusing System.Globalization;\nusing System.Text.Json;\nusing System.Threading;\nusing System.Net.Http;\n${helpers}public static class Driver {static readonly List<object?> Out=new();static void Add(object? v)=>Out.Add(v);public static void Main(){${calls.map((a,i)=>callSource(contract.adapter,contract.entrypoint,a,i)).join('\n')}Console.Write(JsonSerializer.Serialize(Out));}}`;
}
const project=`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>disable</ImplicitUsings><Nullable>enable</Nullable><RestoreIgnoreFailedSources>true</RestoreIgnoreFailedSources></PropertyGroup></Project>`;
export function isolatedCsharpOptions(code:string,contract:IsolatedCsharpJsonContract,calls:JsonValue[][],compileOnly=false):ContainerRunOptions {
  if(!validIsolatedCsharpJsonContract({...contract,cases:[{id:'input',calls,expected:calls.map(()=>({equals:null}))}]}))throw Error('Invalid C# observation input');
  const build='dotnet build app.csproj --nologo --verbosity quiet -o /tmp/build -p:BaseIntermediateOutputPath=/tmp/obj/ >/tmp/build.log 2>&1 || { cat /tmp/build.log >&2; exit 1; }';
  return {image:CSHARP_JSON_IMAGE,command:['sh','-c',`${build}${compileOnly?'':'; dotnet /tmp/build/app.dll'}`],files:[
      {path:'app.csproj',content:project},{path:'Candidate.cs',content:candidateSource(code,contract.adapter)},{path:'Driver.cs',content:driverSource(contract,calls)}],
    localImageOnly:true,readOnlyRoot:true,readOnly:true,networkDisabled:true,runAsNonRoot:true,memoryMb:512,cpuLimit:1,pidsLimit:contract.protocol==='isolated-csharp-json-v2'?160:96,timeoutMs:contract.protocol==='isolated-csharp-json-v2'?30000:15000,maxOutputBytes:65536,
    env:{HOME:'/tmp',TMPDIR:'/tmp',DOTNET_CLI_HOME:'/tmp',NUGET_PACKAGES:'/tmp/nuget',DOTNET_NOLOGO:'1',DOTNET_CLI_TELEMETRY_OPTOUT:'1'},};
}
export async function runIsolatedCsharpJsonSuite(code:string,contract:IsolatedCsharpJsonContract){
  if(!validIsolatedCsharpJsonContract(contract))throw Error('Invalid C# observation contract');
  const syntax=await runInContainer(isolatedCsharpOptions(code,contract,contract.cases[0].calls,true));
  let infrastructureError=syntax.infrastructureError;const details:TestDetail[]=[];
  for(const c of contract.cases){if(infrastructureError)break;const startedAt=new Date().toISOString();const r=syntax.success?await runInContainer(isolatedCsharpOptions(code,contract,c.calls)):syntax;
    infrastructureError=r.infrastructureError;let passed=false;
    if(r.success&&!r.timedOut&&!r.outputLimitExceeded&&!r.infrastructureError)try{const values:unknown=JSON.parse(r.stdout);passed=Array.isArray(values)&&values.length===c.expected.length&&validObservationJson(values)&&c.expected.every((p,i)=>matchesJsonValuePredicate(values[i],p));}catch{}
    details.push({testId:c.id,testType:'hidden',passed,stdout:r.stdout,stderr:r.stderr,actualOutput:r.stdout,exitCode:r.exitCode,timedOut:r.timedOut,duration:r.durationMs,startedAt,finishedAt:new Date().toISOString()});}
  return {compiled:syntax.success,compileError:syntax.success?undefined:syntax.stderr,infrastructureError,details,total:contract.cases.length,passed:details.filter(t=>t.passed).length};
}
