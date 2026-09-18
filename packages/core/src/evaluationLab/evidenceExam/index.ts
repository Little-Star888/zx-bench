import { snapshotHash } from '../../contracts/pack.js';
import { committedItems, type ExamSubmission } from '../examPaper/index.js';
import { exactKeys } from '../challengeTypes.js';
import { temporalStem, snapshot, gradeSnapshot, type Slot } from './temporal.js';
import { rules, updatedRules, ruleStem, referenceRule, gradeRule, names, type Rule } from './rules.js';
import { evidenceCatalogGroups, type ExactEvidenceItem, type JsonValue } from './catalog.js';

type Item={key:string;points:number;kind:'snapshot';slot:Slot}|{key:string;points:number;kind:'rule';rules:Rule[];variable:number}|ExactEvidenceItem;
type Group={id:string;dimension:'data_extraction'|'hallucination_resistance';title:string;stem:string;parts:{material?:string;task:string;items:Item[]}[]};
function temporalItems(valid:number,known:number,fields:[string,string,number][]):Item[]{return fields.map(([entity,field,points])=>({key:`${entity}.${field}`,points,kind:'snapshot',slot:{entity,field,valid,known}}));}
function ruleItems(rs:Rule[],variables:number[],points:number):Item[]{return variables.map(variable=>({key:names[variable-1],points,kind:'rule',rules:rs,variable}));}
export function buildEvidenceExam(){
  const groups:Group[]=[
    {id:'DX3-05',dimension:'data_extraction',title:'双时态工单快照',stem:temporalStem,parts:[
      {task:'查询(V=1,K=1)：A.status、A.owner。',items:temporalItems(1,1,[['A','status',5],['A','owner',5]])},
      {task:'查询(V=5,K=5)：A.status、A.owner、B.status、B.owner。',items:temporalItems(5,5,[['A','status',5],['A','owner',5],['B','status',5],['B','owner',5]])},
      {task:'业务日仍为5，知悉截止改为9：查询A.status、A.owner、B.status、C.status。',items:temporalItems(5,9,[['A','status',7.5],['A','owner',7.5],['B','status',7.5],['C','status',7.5]])},
      {task:'查询(V=7,K=12)：完整提交A、B、C各自的status和owner六项，必须保留冲突与缺失。',items:temporalItems(7,12,[['A','status',8],['A','owner',8],['B','status',8],['B','owner',8],['C','status',4],['C','owner',4]])},
    ]},
    {id:'HX3-11',dimension:'hallucination_resistance',title:'不完备规则与正反见证',stem:ruleStem,parts:[
      {task:'分别判断A、B。',items:ruleItems(rules,[1,2],5)},
      {task:'分别判断F、G，不能只列最后一条蕴含而缺少前提。',items:ruleItems(rules,[6,7],10)},
      {task:'分别判断I、L；若不能确定，提供完整正反赋值。',items:ruleItems(rules,[9,12],15)},
      {task:'撤回S02；新增S15:[-9]、S16:[13,-8]、S17:[8,-13]。旧S02不能再作为依据。分别判断K、N、M、G，并基于更新后的全部有效材料提供依据。',items:ruleItems(updatedRules,[11,14,13,7],10)},
    ]},
    ...evidenceCatalogGroups,
  ];
  // 2026-09-18 修订（v2 → v3）：hardSeconds 的 P1/P2 由 [180,360] 抬到 [300,600]。
  // 实测 09-17 的 5 维 run 里，48 道 DX3/HX3 的 P1/P2 有 2 题（DX3-03-P1、DX3-04-P1）
  // 在 180 秒的盒子里被硬止损 —— 与「不要在时间预算上做文章」同一类错误：
  // 题目作者控制不了模型思考多久，盒子设紧只会制造不可复现的失败。
  // 此处对齐同一仓库数学题包（math-exam-expansion）的前两档 300/600。
  // ⚠️ 改这个数组会同时改变题面文字（时限N秒）与每问的 questionHash、契约 contractHash
  //    ⇒ 必须用 scripts/upgrade-evidence-exam-parts.mjs 重播种题库与 DB。
  const policy={version:'ultra-evidence-exam-2026-09-18-v3',modelCalls:0,productionEligible:true,officialRankingEligible:false,difficultyCalibrated:false,
    hardSeconds:[300,600,1200,1200],partPoints:[10,20,30,40],carrySubmittedAnswers:true,answerFeedback:false,
    timeout:'keep_committed_points',unknownSlots:'ignored_no_credit',automaticModelExecution:false};
  const parts=groups.flatMap(g=>g.parts.map((part,i)=>{
    const id=`${g.id}-P${i+1}`,points=part.items.reduce((s,x)=>s+x.points,0),hardSeconds=policy.hardSeconds[i];
    const question={id,dimension:g.dimension,messages:[{role:'user' as const,content:
      `${g.title}，第${i+1}/4问，${points}分，时限${hardSeconds}秒。\n${g.stem}${part.material?`\n本问新增材料：\n${part.material}`:''}\n本问：${part.task}\n评分项：${part.items.map(x=>`${x.key}(${x.points}分)`).join('、')}。\n`+
      '每项单独提交完整JSON：{"item":"评分项ID","answer":上述格式的答案}。按最后一条完整记录计分；截断尾部不覆盖前次完整提交。未完成项记零，前问得分保留。只对明确列出的槽位计分，额外槽位无分；不使用工具。'}]};
    return {id,groupId:g.id,dimension:g.dimension,number:i+1,points,hardSeconds,items:part.items,question:{...question,questionHash:snapshotHash(question)}};
  }));
  return {policy,parts,questions:parts.map(p=>p.question),contractHash:snapshotHash({policy,parts})};
}
export type EvidenceExam=ReturnType<typeof buildEvidenceExam>;
export function referenceOutput(part:EvidenceExam['parts'][number]){return part.items.map(i=>JSON.stringify({item:i.key,answer:i.kind==='snapshot'?snapshot(i.slot):i.kind==='rule'?referenceRule(i.rules,i.variable):i.expected})).join('\n');}
const round=(n:number)=>Math.round(n*1000000)/1000000;
const leaves=(value:unknown,path='$',out=new Map<string,unknown>())=>{
  if(Array.isArray(value)){if(value.length===0)out.set(path,[]);else value.forEach((v,i)=>leaves(v,`${path}[${i}]`,out));return out;}
  if(value!==null&&typeof value==='object'){const entries=Object.entries(value as Record<string,unknown>);if(entries.length===0)out.set(path,{});else entries.forEach(([k,v])=>leaves(v,`${path}.${k}`,out));return out;}
  out.set(path,value);return out;
};
function gradeExact(expected:JsonValue,answer:unknown,points:number){
  const gold=leaves(expected),submitted=leaves(answer),same=(a:unknown,b:unknown)=>Object.is(a,b)||JSON.stringify(a)===JSON.stringify(b);
  const correct=[...gold].filter(([k,v])=>submitted.has(k)&&same(submitted.get(k),v)).length;
  const denominator=gold.size+submitted.size,fieldF1=denominator?2*correct/denominator:1;
  const wrong=(suffix:string)=>[...gold].filter(([k,v])=>k.endsWith(suffix)&&(!submitted.has(k)||!same(submitted.get(k),v))).length;
  const statusErrors=wrong('.status'),contentErrors=[...gold].filter(([k,v])=>!k.includes('.sources')&&!k.endsWith('.status')&&(!submitted.has(k)||!same(submitted.get(k),v))).length;
  const semanticCap=statusErrors?0.5:contentErrors?0.8:1;
  return {earned:points*Math.min(fieldF1,semanticCap),fieldF1,semanticCap,statusErrors,contentErrors,correctLeaves:correct,expectedLeaves:gold.size,submittedLeaves:submitted.size};
}
export function gradePart(part:EvidenceExam['parts'][number],output:string){
  const parsed=committedItems(output,part.items.map(i=>i.key));
  const items=part.items.map(i=>{
    const submitted=parsed.items.has(i.key),answer=parsed.items.get(i.key);
    const result=i.kind==='snapshot'?gradeSnapshot(i.slot,answer,i.points):i.kind==='rule'?gradeRule(i.rules,i.variable,answer,i.points):gradeExact(i.expected,answer,i.points);
    return {key:i.key,points:i.points,submitted,...result,earned:round(result.earned)};
  });
  return {items,points:part.points,earned:round(items.reduce((s,x)=>s+x.earned,0)),incompleteTail:parsed.incompleteTail,rejectedRecords:parsed.rejected,overflow:parsed.overflow};
}
export function scoreExam(paper:EvidenceExam,input:ExamSubmission){
  if(snapshotHash(paper)!==snapshotHash(buildEvidenceExam())||!input||input.contractHash!==paper.contractHash||!Array.isArray(input.answers)||[input.modelId,input.modelFamily,input.runId].some(x=>typeof x!=='string'||!x.trim()))throw Error('Invalid paper/submission');
  const seen=new Set<string>();
  for(const a of input.answers){
    if(!exactKeys(a,['id','questionHash','outcome','output'])||seen.has(a.id)||typeof a.output!=='string'||!['completed','timeout','truncated','environment_error'].includes(a.outcome)||!paper.parts.some(p=>p.id===a.id&&p.question.questionHash===a.questionHash))throw Error('Unknown/duplicate/stale answer');
    seen.add(a.id);
  }
  const rows=paper.parts.map(p=>{const a=input.answers.find(a=>a.id===p.id);return {id:p.id,groupId:p.groupId,dimension:p.dimension,state:a?.outcome??'not_attempted',...gradePart(p,a?.output??'')};});
  const dimensions=[...new Set(rows.map(r=>r.dimension))].map(d=>{
    const r=rows.filter(r=>r.dimension===d),earned=round(r.reduce((s,x)=>s+x.earned,0)),points=r.reduce((s,x)=>s+x.points,0),comparable=r.every(x=>!['environment_error','not_attempted'].includes(x.state));
    return {dimension:d,earned,points,comparable,score:comparable?round(100*earned/points):null};
  });
  return {contractHash:paper.contractHash,modelId:input.modelId,rows,dimensions,productionEligible:paper.policy.productionEligible,officialRankingEligible:paper.policy.officialRankingEligible,difficultyCalibrated:paper.policy.difficultyCalibrated};
}
export function examMessages(paper:EvidenceExam,part:EvidenceExam['parts'][number],input:ExamSubmission['answers']){
  const messages:{role:'user'|'assistant';content:string}[]=[];
  for(const p of paper.parts.filter(p=>p.groupId===part.groupId&&p.number<part.number)){
    const a=input.find(a=>a.id===p.id);if(!a||a.outcome==='environment_error')continue;
    const prior=committedItems(a.output,p.items.map(i=>i.key));
    messages.push(...p.question.messages,{role:'assistant',content:prior.items.size?[...prior.items].map(([item,answer])=>JSON.stringify({item,answer})).join('\n'):'本问未提交完整答案。'});
  }
  return [...messages,...part.question.messages];
}
