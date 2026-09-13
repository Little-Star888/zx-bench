import type { QuickJsObservationFixture } from './quickJsObservationGold.js';
import type { QuickJsObservationCase, QuickJsExpected } from '../execution/quickJsObservation.js';
import type { JsonValue } from '../execution/isolatedJson.js';
const returns=(value:JsonValue):QuickJsExpected=>({outcome:{kind:'return',value}});
const throws=(equals:string):QuickJsExpected=>({outcome:{kind:'throw',message:{equals}}});
const point=(id:string,args:JsonValue[],expected:QuickJsExpected):QuickJsObservationCase=>({id,calls:[args],expected:[expected]});
const transition=`function transition(state,event){
  if(event==='abort')return 'aborted';
  const next={idle:{plan:'planning'},planning:{act:'acting'},acting:{finish:'done',fail:'planning'}};
  if(Object.hasOwn(next,state)&&Object.hasOwn(next[state],event))return next[state][event];
  throw new Error('invalid transition');
}`;
const validate=`function validateToolCall(call,schema){
  if(call.name!==schema.name)throw new Error('unknown tool');
  for(const key of schema.required)if(!Object.hasOwn(call.args,key))throw new Error('missing: '+key);
  for(const key of schema.forbidden)if(Object.hasOwn(call.args,key))throw new Error('forbidden: '+key);
  return true;
}`;
const render=`function renderComment(text){
  const entities={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
  return '<div class="comment">'+text.replace(/[&<>"']/g,char=>entities[char])+'</div>';
}`;
// Developer controls only. No hidden challenge is promoted into old test IDs.
export const QUICKJS_OBSERVATION_V2_PILOTS:Record<string,QuickJsObservationFixture>={
  'CP-L3-AW-JS-004':{
    language:'javascript',correct:transition,
    contract:{protocol:'quickjs-observation-v2',entrypoint:'transition',cases:[
      {id:'CP-L3-AW-JS-004-hidden-1',calls:[['idle','plan'],['planning','act'],['acting','finish']],expected:[returns('planning'),returns('acting'),returns('done')]},
      point('CP-L3-AW-JS-004-hidden-2',['acting','fail'],returns('planning')),
      point('CP-L3-AW-JS-004-hidden-3',['done','act'],throws('invalid transition')),
      point('CP-L3-AW-JS-004-hidden-4',['acting','abort'],returns('aborted')),
    ]},
    mutants:[
      {id:'wrong-error-message',description:'Throws, but drops the exact message required by the old test.',code:transition.replace("new Error('invalid transition')","new Error('invalid')")},
      {id:'abort-only-acting',description:'Old tests exercise abort only from acting; violates any-state abort.',code:transition.replace("if(event==='abort')","if(event==='abort'&&state==='acting')")},
    ],
    developmentCases:[
      {id:'transition-dev-abort-states',calls:[['idle','abort'],['planning','abort'],['done','abort'],['aborted','abort']],expected:Array.from({length:4},()=>returns('aborted'))},
      point('transition-dev-invalid-event',['idle','finish'],throws('invalid transition')),
    ],
    notes:['Old catch asserts message equality, not instanceof Error; plain thrown message data remains acceptable. Getters are explicitly outside the v2 observation contract.','All six old calls remain four test IDs. Abort-state expansion is development-only.'],
  },
  'CP-L3-AW-JS-003':{
    language:'javascript',correct:validate,
    contract:{protocol:'quickjs-observation-v2',entrypoint:'validateToolCall',cases:[
      point('CP-L3-AW-JS-003-hidden-1',[{name:'read',args:{path:'/a'}},{name:'read',required:['path'],forbidden:[]}],returns(true)),
      point('CP-L3-AW-JS-003-hidden-2',[{name:'read',args:{}},{name:'read',required:['path'],forbidden:[]}],{outcome:{kind:'throw',message:{includes:['missing']}}}),
      point('CP-L3-AW-JS-003-hidden-3',[{name:'exec',args:{cmd:'ls',sudo:true}},{name:'exec',required:['cmd'],forbidden:['sudo']}],{outcome:{kind:'throw',message:{includes:['forbidden']}}}),
    ]},
    mutants:[
      {id:'generic-errors',description:'Rejects bad calls but gives neither required message token.',code:validate.replace("'missing: '+key","'invalid'").replace("'forbidden: '+key","'invalid'")},
      {id:'ignores-tool-name',description:'Passes old three points but permits a different tool name.',code:validate.replace("if(call.name!==schema.name)throw new Error('unknown tool');",'')},
    ],
    developmentCases:[
      point('validate-dev-wrong-name',[{name:'write',args:{path:'/a'}},{name:'read',required:['path'],forbidden:[]}],throws('unknown tool')),
      point('validate-dev-false-is-present',[{name:'exec',args:{cmd:'ls',sudo:false}},{name:'exec',required:['cmd'],forbidden:['sudo']}],throws('forbidden: sudo')),
      point('validate-dev-zero-required',[{name:'read',args:{offset:0}},{name:'read',required:['offset'],forbidden:[]}],returns(true)),
    ],
    notes:['Old missing/forbidden checks retain substring semantics rather than invented exact messages.','Name check, false-valued forbidden presence and zero-valued required presence are prompt-derived development cases; no inherited-argument or malformed-schema rule is added.'],
  },
  'CP-L3-SEC-JS-002':{
    language:'javascript',correct:render,
    contract:{protocol:'quickjs-observation-v2',entrypoint:'renderComment',cases:[
      point('CP-L3-SEC-JS-002-hidden-1',['<script>alert(1)</script>'],{outcome:{kind:'return',stringMatch:{includes:['&lt;script&gt;'],excludes:['<script>']}}}),
      point('CP-L3-SEC-JS-002-hidden-2',['hi'],returns('<div class="comment">hi</div>')),
      point('CP-L3-SEC-JS-002-hidden-3',['a"b&c'],{outcome:{kind:'return',stringMatch:{includes:['&quot;','&amp;']}}}),
    ]},
    mutants:[
      {id:'leaves-ampersand',description:'Escapes angles/quotes but leaves ampersands.',code:render.replace("'&':'&amp;'","'&':'&'")},
      {id:'leaves-apostrophe',description:'Passes old points because apostrophes were never tested.',code:render.replace("\"'\":'&#39;'","\"'\":\"'\"")},
    ],
    developmentCases:[
      point('render-dev-apostrophe',["'"],{outcome:{kind:'return',stringMatch:{excludes:["'"],includes:['<div class="comment">','</div>']}}}),
      point('render-dev-ampersand-literal',['&amp;'],returns('<div class="comment">&amp;amp;</div>')),
      point('render-dev-empty',[''],returns('<div class="comment"></div>')),
    ],
    notes:['Formal string includes/excludes remain partial checks, not a fabricated full HTML answer. String return type is explicit in the prompt and v2 protocol.','The apostrophe development case deliberately permits numeric or named entity spellings; it is a bounded regression, not a browser/XSS security proof.'],
  },
};
