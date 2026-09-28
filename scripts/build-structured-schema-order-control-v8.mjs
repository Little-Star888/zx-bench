// Reorder the frozen event cases so finite-case classification cannot pass by
// selecting a contiguous prefix. Keep the source rules and behavioral oracle.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {hashScenarioShort} from '../packages/core/dist/contracts/canonicalize.js';
const sourceRoot='data/pilots/structured-contract-frontier-v7',root='data/pilots/structured-contract-frontier-v8';
const source=JSON.parse(fs.readFileSync(`${sourceRoot}/development.json`,'utf8'));
const sourceGold=JSON.parse(fs.readFileSync(`${sourceRoot}/gold.private.json`,'utf8'));
const structured=structuredClone(source.find(s=>s.id==='SYN7-EVENT-STRUCTURED'));
const base=structuredClone(source.find(s=>s.id==='SYN7-EVENT-BASE'));
const original=structured.requirements.generatedSchema.cases;
const order=[6,0,7,8,1,9,10,2,11,12,3,13,14,4,15,16,5,17,18,19];
if(order.length!==original.length||new Set(order).size!==original.length)throw Error('Invalid permutation');
const cases=order.map(i=>original[i]);
const validIds=cases.flatMap((c,i)=>c.valid?[String(i+1).padStart(2,'0')]:[]);
if(validIds.join(',')!=='02,05,08,11,14,17')throw Error('Unexpected positive positions');
const pairId='SYN8-EVENT';
const rules=structured.promptTemplate.split('规则：\n')[1];
base.id=`${pairId}-BASE`;base.requirements.pairId=pairId;
base.requirements.assertions[0].expected=validIds;
base.promptTemplate=`判断每个样本是否符合以下规则。只输出一个 JSON 对象，validIds 为有效样本的两位编号数组，按编号升序排列。不要解释。\n\n规则：\n${rules}\n\n样本：\n${cases.map((c,i)=>`${String(i+1).padStart(2,'0')}: ${JSON.stringify(c.data)}`).join('\n')}\n\n输出 Schema：${JSON.stringify(base.requirements.schema)}`;
structured.id=`${pairId}-STRUCTURED`;structured.requirements.pairId=pairId;
structured.requirements.generatedSchema.cases=cases;
for(const s of [base,structured]){delete s.scenarioHash;s.scenarioHash=hashScenarioShort(s);}
const development=[base,structured],holdout=[];
const gold=[{id:base.id,split:'development',pairId,variant:'base',raw:JSON.stringify({validIds})},
  {id:structured.id,split:'development',pairId,variant:'structured',raw:sourceGold.find(g=>g.id==='SYN7-EVENT-STRUCTURED').raw}];
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const manifest={version:'structured-contract-frontier-v8-order-control',status:'development-only',counts:{development:2,holdout:0},
  source:{derivedFrom:'structured-contract-frontier-v7/SYN7-EVENT',caseOrder:order,
    purpose:'Finite-case label interleaving prevents contiguous-prefix shortcut; schema task unchanged except test order.'},
  hashes:{development:sha(development),holdout:sha(holdout),gold:sha(gold)},modelCalls:0};
fs.mkdirSync(root,{recursive:true});
for(const [name,value] of Object.entries({'development.json':development,'holdout.json':holdout,'gold.private.json':gold,'manifest.json':manifest}))
  fs.writeFileSync(`${root}/${name}`,JSON.stringify(value,null,2)+'\n');
console.log(JSON.stringify({root,validIds,hashes:manifest.hashes}));
