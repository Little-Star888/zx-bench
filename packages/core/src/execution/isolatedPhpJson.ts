/** Adapter-bounded PHP observations for file and process-lifetime behavior.
 * Candidate code receives only the current action, never IDs, expectations or verdicts. */
import type { TestDetail } from '@zxbench/types';
import { runInContainer, type ContainerRunOptions } from './containerRunner.js';
import { validObservationJson } from './quickJsObservation.js';
import { validJsonValuePredicate, matchesJsonValuePredicate, type JsonValuePredicate } from './jsonValuePredicate.js';
import type { JsonValue } from './isolatedJson.js';

export const PHP_JSON_V2_IMAGE='php@sha256:6d3dcc922fa36d06d6eefba5697a0aee599cf2f306b3cc2700a6526bc8fd5c09';
export type PhpJsonAdapter='csv-generator'|'template-cache';
export interface IsolatedPhpJsonCase{id:string;calls:JsonValue[][];expected:JsonValuePredicate[]}
export interface IsolatedPhpJsonContract{protocol:'isolated-php-json-v2';entrypoint:string;adapter:PhpJsonAdapter;cases:IsolatedPhpJsonCase[]}
const rec=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const int=(v:unknown,min:number,max:number)=>Number.isInteger(v)&&Number(v)>=min&&Number(v)<=max;
function validCall(adapter:PhpJsonAdapter,call:unknown[]){
  if(adapter==='csv-generator')return call.length===3&&['stream','shape','header','first','leak'].includes(call[0] as string)
    &&int(call[1],0,60000)&&int(call[2],0,256);
  return call.length===2&&['version','path','render','empty'].includes(call[0] as string)
    &&Array.isArray(call[1])&&call[1].length<=100&&call[1].every(v=>typeof v==='string'&&v.length<=256);
}
export function validIsolatedPhpJsonContract(v:unknown):v is IsolatedPhpJsonContract{
  if(!rec(v)||v.protocol!=='isolated-php-json-v2'||!['csv-generator','template-cache'].includes(v.adapter as string)
    ||typeof v.entrypoint!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.entrypoint)
    ||!Array.isArray(v.cases)||!v.cases.length||v.cases.length>20)return false;
  const ids=new Set<string>();
  return v.cases.every((c:unknown)=>rec(c)&&typeof c.id==='string'&&c.id.length>0&&!ids.has(c.id)&&!!ids.add(c.id)
    &&Array.isArray(c.calls)&&c.calls.length>0&&c.calls.length<=20
    &&c.calls.every((x:unknown)=>Array.isArray(x)&&validObservationJson(x)&&validCall(v.adapter as PhpJsonAdapter,x))
    &&Array.isArray(c.expected)&&c.expected.length===c.calls.length&&validObservationJson(c.expected)&&c.expected.every(validJsonValuePredicate));
}
const csvDriver=`<?php
$request=json_decode(file_get_contents('/workspace/input.json'),true,512,JSON_THROW_ON_ERROR);
ob_start();require '/workspace/candidate.php';
function csvFile(array $rows,array $header=['id','name','payload']):string{$p=tempnam('/tmp','zx-csv-');$h=fopen($p,'w');fputcsv($h,$header);foreach($rows as $r)fputcsv($h,$r);fclose($h);return $p;}
$out=[];
foreach($request['calls'] as $call){[$action,$n,$payload]=$call;
 if($action==='stream'){$p=tempnam('/tmp','zx-big-');$h=fopen($p,'w');fputcsv($h,['id','name','payload']);for($i=0;$i<$n;$i++)fputcsv($h,[$i,'user'.$i,str_repeat('x',$payload)]);fclose($h);$before=memory_get_peak_usage(true);$g=readCsv($p);$count=0;$sum=0;foreach($g as $row){$count++;$sum+=(int)$row['id'];}$delta=memory_get_peak_usage(true)-$before;$out[]=[$g instanceof Generator,$count,$delta<=8*1024*1024,$sum];unlink($p);continue;}
 if($action==='shape'){$p=csvFile([['a1','b1','c1'],['a2','b2'],['a3','b3','c3','d3']]);$rows=[];foreach(readCsv($p) as $r)$rows[]=$r;$out[]=$rows;unlink($p);continue;}
 if($action==='header'){$p=csvFile([]);$count=0;foreach(readCsv($p) as $_)$count++;$out[]=$count;unlink($p);continue;}
 if($action==='first'){$p=csvFile([['1','n1','p1'],['2','n2','p2']]);$g=readCsv($p);$first=null;foreach($g as $r){$first=$r['id']??null;break;}$out[]=[$g instanceof Generator,$first];unset($g);unlink($p);continue;}
 $p=csvFile([['1','n1','p1'],['2','n2','p2'],['3','n3','p3']]);$before=count(get_resources('stream'));$g=readCsv($p);foreach($g as $_)break;unset($g);gc_collect_cycles();$out[]=count(get_resources('stream'))<=$before;unlink($p);
}
ob_end_clean();echo json_encode($out,JSON_THROW_ON_ERROR|JSON_PRESERVE_ZERO_FRACTION|JSON_UNESCAPED_UNICODE);`;
const templateDriver=`<?php
$request=json_decode(file_get_contents('/workspace/input.json'),true,512,JSON_THROW_ON_ERROR);
ob_start();require '/workspace/candidate.php';$out=[];
foreach($request['calls'] as $call){[$action,$vars]=$call;
 if($action==='version'){$m=new ReflectionMethod('Config','invalidate');$shape=$m->isPublic()&&$m->isStatic()&&$m->getNumberOfParameters()===1&&((string)$m->getParameters()[0]->getType())==='string';Config::invalidate('v1');$initial=Config::get('factor');$p=new ReflectionProperty('Config','cache');$p->setAccessible(true);$p->setValue(null,['factor'=>9]);Config::invalidate('v1');$same=Config::get('factor');Config::invalidate('v2');$changed=Config::get('factor');$out[]=[$shape,$initial,$same,$changed];continue;}
 if($action==='path'){$out[]=[Templates::render('home',['a']),Templates::render('home',['bb'])];continue;}
 if($action==='render'){$out[]=Templates::render('home',$vars);continue;}
 $out[]=[Templates::render('home',[]),Config::get('missing-key')];
}
ob_end_clean();echo json_encode($out,JSON_THROW_ON_ERROR|JSON_PRESERVE_ZERO_FRACTION|JSON_UNESCAPED_UNICODE);`;
const phpSource=(code:string)=>'<?php\n'+code.trim().replace(/^<\?php\s*/,'').replace(/\?>\s*$/,'');
export function isolatedPhpOptions(code:string,contract:IsolatedPhpJsonContract,calls:JsonValue[][],compileOnly=false):ContainerRunOptions{
  if(!validIsolatedPhpJsonContract({...contract,cases:[{id:'input',calls,expected:calls.map(()=>({equals:null}))}]}))throw Error('Invalid PHP observation input');
  const files=[{path:'candidate.php',content:phpSource(code)}];
  if(!compileOnly){files.push({path:'driver.php',content:contract.adapter==='csv-generator'?csvDriver:templateDriver},{path:'input.json',content:JSON.stringify({calls})});
    if(contract.adapter==='template-cache')files.push({path:'config.json',content:'{"factor":2}\n'},{path:'tpl/home.php',content:"<?php echo 'T';\n"});}
  return {image:PHP_JSON_V2_IMAGE,command:compileOnly?['php','-l','candidate.php']:['php','-d','display_errors=stderr','driver.php'],files,
    localImageOnly:true,readOnlyRoot:true,readOnly:true,networkDisabled:true,runAsNonRoot:true,memoryMb:128,cpuLimit:1,pidsLimit:32,
    timeoutMs:contract.adapter==='csv-generator'?30000:5000,maxOutputBytes:65536,env:{HOME:'/tmp'}};
}
export async function runIsolatedPhpJsonSuite(code:string,contract:IsolatedPhpJsonContract){
  if(!validIsolatedPhpJsonContract(contract))throw Error('Invalid PHP observation contract');
  const syntax=await runInContainer(isolatedPhpOptions(code,contract,contract.cases[0].calls,true));
  let infrastructureError=syntax.infrastructureError;const details:TestDetail[]=[];
  for(const c of contract.cases){if(infrastructureError)break;const startedAt=new Date().toISOString();const r=syntax.success?await runInContainer(isolatedPhpOptions(code,contract,c.calls)):syntax;infrastructureError=r.infrastructureError;let passed=false;
    if(r.success&&!r.timedOut&&!r.outputLimitExceeded&&!r.infrastructureError)try{const v:unknown=JSON.parse(r.stdout);passed=Array.isArray(v)&&v.length===c.expected.length&&validObservationJson(v)&&c.expected.every((p,i)=>matchesJsonValuePredicate(v[i],p));}catch{}
    details.push({testId:c.id,testType:'hidden',passed,stdout:r.stdout,stderr:r.stderr,actualOutput:r.stdout,exitCode:r.exitCode,timedOut:r.timedOut,duration:r.durationMs,startedAt,finishedAt:new Date().toISOString()});}
  return {compiled:syntax.success,compileError:syntax.success?undefined:syntax.stderr,infrastructureError,details,total:contract.cases.length,passed:details.filter(x=>x.passed).length};
}
