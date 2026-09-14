import { exactKeys } from '../challengeTypes.js';

export interface Event { id: string; entity: string; field: string; valid: number; known: number; value: string; }
export interface Revision { id: string; root: string; known: number; value: string | null; }
export const events: Event[] = [
  {id:'E01',entity:'A',field:'status',valid:1,known:1,value:'open'},
  {id:'E02',entity:'A',field:'owner',valid:1,known:1,value:'Lin'},
  {id:'E03',entity:'B',field:'status',valid:2,known:2,value:'open'},
  {id:'E04',entity:'B',field:'owner',valid:2,known:2,value:'He'},
  {id:'E05',entity:'A',field:'status',valid:4,known:4,value:'closed'},
  {id:'E06',entity:'A',field:'owner',valid:4,known:6,value:'Wu'},
  {id:'E07',entity:'B',field:'status',valid:5,known:5,value:'closed'},
  {id:'E08',entity:'C',field:'status',valid:3,known:8,value:'open'},
  {id:'E09',entity:'A',field:'status',valid:6,known:7,value:'reopened'},
  {id:'E10',entity:'B',field:'owner',valid:6,known:8,value:'Zhou'},
  {id:'E11',entity:'B',field:'owner',valid:6,known:9,value:'Sun'},
  {id:'E12',entity:'C',field:'owner',valid:8,known:9,value:'Lu'},
  {id:'E13',entity:'C',field:'status',valid:7,known:10,value:'closed'},
  {id:'E14',entity:'A',field:'owner',valid:7,known:11,value:'He'},
];
export const revisions: Revision[] = [
  {id:'R01',root:'E05',known:7,value:null},
  {id:'R02',root:'E07',known:8,value:'reopened'},
  {id:'R03',root:'E06',known:9,value:'Chen'},
  {id:'R04',root:'E09',known:10,value:null},
  {id:'R05',root:'E07',known:11,value:null},
  {id:'R06',root:'E13',known:12,value:null},
];
export interface Slot { entity: string; field: string; valid: number; known: number }
export function snapshot(slot: Slot) {
  const candidates = events.filter(e => e.entity===slot.entity && e.field===slot.field && e.valid<=slot.valid && e.known<=slot.known).map(e => {
    const r = revisions.filter(r => r.root===e.id && r.known<=slot.known).sort((a,b)=>b.known-a.known)[0];
    return { event:e, value:r ? r.value : e.value, sources:r ? [e.id,r.id] : [e.id] };
  });
  const active=candidates.filter(e=>e.value!==null);
  const latest=Math.max(-1,...active.map(x=>x.event.valid));
  const winning=active.filter(e=>e.event.valid===latest);
  const values=[...new Set(winning.map(e=>e.value!))].sort();
  // Audit traces explicitly include tombstones that cause a rollback.
  const sources=[...new Set([...winning,...candidates.filter(e=>e.value===null && e.event.valid>=latest)].flatMap(e=>e.sources))].sort();
  return {status:values.length===0?'missing':values.length===1?'determined':'conflict',
    value:values.length===0?null:values.length===1?values[0]:values,sources};
}
export function gradeSnapshot(slot: Slot, answer: unknown, points: number) {
  const gold=snapshot(slot);
  if (!exactKeys(answer,['status','value','sources'])) return {earned:0,valueCorrect:false,evidenceCorrect:false};
  const sameSet=(a:unknown,b:string[])=>Array.isArray(a)&&new Set(a).size===a.length&&a.length===b.length&&a.every(x=>typeof x==='string'&&b.includes(x));
  const valueCorrect=answer.status===gold.status && (Array.isArray(gold.value)?sameSet(answer.value,gold.value):answer.value===gold.value);
  const evidenceCorrect=valueCorrect&&sameSet(answer.sources,gold.sources);
  return {earned:valueCorrect?points*(evidenceCorrect?1:0.7):0,valueCorrect,evidenceCorrect};
}
export const temporalStem = `以下是封闭的工单事件账本，日期均为同一月份的日号。entity为工单，field为字段，valid为业务生效日，known为系统收到日。查询(V,K)只使用valid≤V且known≤K的原事件，以及known≤K的修订。修订只替换所指原事件的值，保留其entity/field/valid；null表示撤销原事件。同一原事件以可见的最后修订为准。对未撤销事件按valid取最大者；同valid的不同原事件同级，不能按known分先后：值不同则conflict。无可用事件为missing，不把缺失当成关闭。\n事件=${JSON.stringify(events)}\n修订=${JSON.stringify(revisions)}\n每个字段提交{status:"determined"|"missing"|"conflict",value:单值|null|不同候选值数组,sources:[记录ID]}。来源是审计轨迹：所有胜出原事件及各自最后可见修订，加上valid不早于胜出事件、因撤销而跳过的原事件及最后修订；不附无关/更早覆盖记录。无胜出事件时列出本字段全部符合日期条件的撤销记录及其最后修订；完全无符合条件记录时sources=[]。值正确得该项70%，审计轨迹完整准确再得30%。`;
