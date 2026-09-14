import { exactKeys } from '../challengeTypes.js';

export interface Rule { id:string; clause:number[] }
// Signed integers denote positive/negative literals of A..N. No closed-world rule.
export const rules:Rule[]=[
  {id:'S01',clause:[1]},{id:'S02',clause:[-2]},
  {id:'S03',clause:[-1,3]},{id:'S04',clause:[-3,4]},
  {id:'S05',clause:[-4,5]},{id:'S06',clause:[-5,6]},
  {id:'S07',clause:[2,-7]},{id:'S08',clause:[-7,8]},
  {id:'S09',clause:[9,10]},{id:'S10',clause:[-9,-10]},
  {id:'S11',clause:[-10,11]},{id:'S12',clause:[-11,12]},
  {id:'S13',clause:[12,13]},{id:'S14',clause:[-12,14]},
];
export const updatedRules:Rule[]=[...rules.filter(r=>r.id!=='S02'),
  {id:'S15',clause:[-9]},{id:'S16',clause:[13,-8]},{id:'S17',clause:[8,-13]}];
export const names='ABCDEFGHIJKLMN'.split('');
function satisfies(mask:number, rs:Rule[]) {return rs.every(r=>r.clause.some(l=>Boolean(mask&(1<<(Math.abs(l)-1)))===(l>0)));}
const cache=new Map<string,number[]>();
export function worlds(rs:Rule[]) {
  const key=JSON.stringify(rs);let out=cache.get(key);
  if(!out){out=[];for(let m=0;m<2**names.length;m++)if(satisfies(m,rs))out.push(m);cache.set(key,out);}
  return out;
}
const bit=(mask:number,variable:number)=>Boolean(mask&(1<<(variable-1)));
export function conclusion(rs:Rule[],variable:number) {
  const models=worlds(rs);if(!models.length)throw Error('This consistent-rule task cannot use an inconsistent premise set');
  const yes=models.find(m=>bit(m,variable)),no=models.find(m=>!bit(m,variable));
  return {status:yes!==undefined&&no!==undefined?'insufficient':'determined',value:yes!==undefined&&no!==undefined?null:yes!==undefined,yes,no};
}
const assignment=(m:number)=>names.map((_,i)=>bit(m,i+1));
function supportValid(rs:Rule[],variable:number,value:boolean) {
  const models=worlds(rs);return models.length>0&&models.every(m=>bit(m,variable)===value);
}
export function referenceRule(rs:Rule[],variable:number) {
  const c=conclusion(rs,variable);
  if(c.status==='insufficient')return {status:c.status,value:null,witnessTrue:assignment(c.yes!),witnessFalse:assignment(c.no!)};
  let support=rs.slice();
  for(const r of rs){const reduced=support.filter(x=>x.id!==r.id);if(supportValid(reduced,variable,c.value!))support=reduced;}
  return {status:c.status,value:c.value,sources:support.map(r=>r.id)};
}
export function gradeRule(rs:Rule[],variable:number,answer:unknown,points:number) {
  const c=conclusion(rs,variable);
  const shape=c.status==='determined'?['status','value','sources']:['status','value','witnessTrue','witnessFalse'];
  if(!exactKeys(answer,shape))return {earned:0,classificationCorrect:false,evidenceCorrect:false};
  const classificationCorrect=answer.status===c.status&&answer.value===c.value;
  let evidenceCorrect=false;
  if(classificationCorrect&&c.status==='determined'&&Array.isArray(answer.sources)){
    const ids=answer.sources;
    if(ids.length<=rs.length&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&rs.some(r=>r.id===id))){
      const subset=rs.filter(r=>ids.includes(r.id));
      evidenceCorrect=supportValid(subset,variable,c.value!)&&subset.every(r=>!supportValid(subset.filter(x=>x.id!==r.id),variable,c.value!));
    }
  } else if(classificationCorrect&&c.status==='insufficient') {
    const witness=(v:unknown,wanted:boolean)=>{
      if(!Array.isArray(v)||v.length!==names.length||v.some(x=>typeof x!=='boolean'))return false;
      const m=v.reduce((s,x,i)=>s+(x?1<<i:0),0);return bit(m,variable)===wanted&&satisfies(m,rs);
    };
    evidenceCorrect=witness(answer.witnessTrue,true)&&witness(answer.witnessFalse,false);
  }
  return {earned:classificationCorrect?points*(evidenceCorrect?1:0.3):0,classificationCorrect,evidenceCorrect};
}
export const ruleStem=`A..N是14个布尔命题；只依据下列材料，不把未提及命题当作假。每条clause表示“或”；正整数i表示第i个命题为真，负整数-i表示其为假。所有有效材料必须同时满足；例如[-1,3]表示A蕴含C。材料=${JSON.stringify(rules)}。\n判断目标命题在所有满足材料的赋值中是否固定。固定时提交{status:"determined",value:true或false,sources:[材料ID]}，sources须足以推出结论且删除其中任一条后不再足够，允许任意合法的极小支持集。未固定时提交{status:"insufficient",value:null,witnessTrue:[A..N的14个布尔值],witnessFalse:[同格式]}，分别让目标为真/假且均满足全部有效材料。不接受仅以“资料不足”代替见证。判断正确占30%，依据正确占70%；不执行代码。`;
