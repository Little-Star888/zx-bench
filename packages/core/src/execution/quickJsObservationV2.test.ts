import {describe,it,expect} from 'vitest';
import {compareQuickJsObservations,validQuickJsObservationContract,validStringObservationMatch,runQuickJsObservationSuite,type QuickJsExpected} from './quickJsObservation.js';
const message:QuickJsExpected={outcome:{kind:'throw',message:{equals:'missing: path'}}};
const contract=(expected:QuickJsExpected=message)=>({protocol:'quickjs-observation-v2' as const,entrypoint:'target',cases:[{id:'only',calls:[[[1]]],expected:[expected]}]});
it('accepts only bounded, nonempty declarative string constraints',()=>{
  for(const match of [{equals:''},{includes:['missing']},{excludes:['<script>']},{equals:'abc',includes:['a'],excludes:['z']}])expect(validStringObservationMatch(match)).toBe(true);
  for(const match of [{},{includes:[]},{includes:['']},{equals:0},{regex:'.*'},{includes:['a',null]},{equals:'x'.repeat(8193)}])expect(validStringObservationMatch(match)).toBe(false);
});
it('version-gates new assertions and rejects cross-kind or malformed predicates',()=>{
  expect(validQuickJsObservationContract(contract())).toBe(true);
  expect(validQuickJsObservationContract({...contract(),protocol:'quickjs-observation-v1'})).toBe(false);
  for(const outcome of [{kind:'return',message:{equals:'x'}},{kind:'throw',stringMatch:{equals:'x'}},{kind:'throw',message:{}},{kind:'return',stringMatch:{includes:[]}}])
    expect(validQuickJsObservationContract(contract({outcome} as any))).toBe(false);
});
it('does not accept an old protocol or textual self-report for a v2 observation',()=>{
  const observation={kind:'throw',message:{kind:'string',value:'missing: path'},argumentsAfter:[]};
  const report={protocol:'quickjs-observation-v2',status:'ok',observations:[observation]};
  expect(compareQuickJsObservations(JSON.stringify(report),[message],'quickjs-observation-v2')).toBe(true);
  for(const modified of [{...report,protocol:'quickjs-observation-v1'}, {...report,observations:[{...observation,message:'missing: path'}]},
    {...report,observations:[{...observation,message:{kind:'unsupported',value:'missing: path'}}]}])
    expect(compareQuickJsObservations(JSON.stringify(modified),[message],'quickjs-observation-v2')).toBe(false);
  expect(compareQuickJsObservations(JSON.stringify({...report,protocol:'quickjs-observation-v1'}),[message])).toBe(false);
});
it('uses exact string types and conjunctive literal predicates on the host',()=>{
  const expected:QuickJsExpected={outcome:{kind:'return',stringMatch:{includes:['A','B'],excludes:['X']}}};
  const check=(value:unknown)=>compareQuickJsObservations(JSON.stringify({protocol:'quickjs-observation-v2',status:'ok',observations:[
    {kind:'return',valueType:'json',value,argumentsAfter:[],sameArgument:[]}]}),[expected],'quickjs-observation-v2');
  expect(check('prefix A B suffix')).toBe(true);
  for(const value of ['A','A B X',['A','B'],{includes:true},null])expect(check(value)).toBe(false);
});

const samples:[string,string,QuickJsExpected,boolean][]=[
  ['native-message',`function target(){throw new Error('missing: path')}`,message,true],
  ['wrong-message',`function target(){throw new Error('missing')}`,message,false],
  ['return-is-not-throw',`function target(){return {message:'missing: path'}}`,message,false],
  ['plain-thrown-data-preserves-old-semantics',`function target(){throw {message:'missing: path'}}`,message,true],
  ['inherited-data-message',`function target(){throw Object.create({message:'missing: path'})}`,message,true],
  ['message-getter-not-invoked',`function target(a){throw {get message(){a[0]=9;return 'missing: path'}}}`,message,false],
  ['message-coercion-not-invoked',`function target(a){throw {message:{toString(){a[0]=9;return 'missing: path'}}}}`,message,false],
  ['fake-message-includes-method',`function target(){throw {message:{includes(){return true}}}}`,{outcome:{kind:'throw',message:{includes:['missing']}}},false],
  ['guest-string-prototype-not-authority',`function target(){String.prototype.includes=()=>true;throw new Error('wrong')}`,{outcome:{kind:'throw',message:{includes:['missing']}}},false],
  ['unicode-nul-surrogate-message',`function target(){throw new Error('缺参\\u0000尾\\ud800')}`,{outcome:{kind:'throw',message:{equals:'缺参\0尾\ud800'}}},true],
  ['primitive-throw-has-no-message',`function target(){throw 'missing: path'}`,message,false],
  ['literal-string-subsequence',`function target(){return 'prefix &lt;script&gt; suffix'}`,{outcome:{kind:'return',stringMatch:{includes:['&lt;script&gt;'],excludes:['<script>']}}},true],
  ['raw-tag-is-still-forbidden',`function target(){return '&lt;script&gt; <script>'}`,{outcome:{kind:'return',stringMatch:{includes:['&lt;script&gt;'],excludes:['<script>']}}},false],
];
describe.skipIf(process.env.ZXBENCH_CONTAINER_TESTS!=='1')('v2 isolated message/string controls',()=>{
  it.each(samples)('%s',async(id,code,expected,pass)=>{
    const r=await runQuickJsObservationSuite(code,'javascript',contract(expected));
    expect(r.infrastructureError,JSON.stringify(r.details)).toBeUndefined();
    expect(r.passed,JSON.stringify(r.details)).toBe(pass?1:0);
    if(id.endsWith('not-invoked')){
      const o=JSON.parse(r.details[0].stdout).observations[0];
      expect(o.message).toEqual({kind:'unsupported'});expect(o.argumentsAfter).toEqual([[1]]);
    }
  },30_000);
  it('v1 does not newly inspect error-message accessors',async()=>{
    const c={...contract({outcome:{kind:'throw',errorType:'Error'},argumentsAfter:[[1]]}),protocol:'quickjs-observation-v1' as const};
    const r=await runQuickJsObservationSuite(`function target(a){const e=new Error();Object.defineProperty(e,'message',{get(){a[0]=9;throw 1}});throw e}`,'javascript',c);
    expect(r.infrastructureError).toBeUndefined();expect(r.passed,JSON.stringify(r.details)).toBe(1);
    expect(JSON.parse(r.details[0].stdout).observations[0]).not.toHaveProperty('message');
  },30_000);
});
