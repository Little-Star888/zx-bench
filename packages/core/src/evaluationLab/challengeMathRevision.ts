import {exactIntegerArray,exactKeys,numericEqual,result,type ChallengeGrade,type MathCase} from './challengeTypes.js';

export const MC2_004_REVISION_VERSION='mc2-004-r1-2026-09-13';

type CountState={zeros:number;ones:number;twos:number;last:number;mod:number;first:number};

/**
 * MC2-004-R1 keeps the intended constrained-counting skill while bounding the
 * state space.  The residue histogram is a compact, independently checkable
 * certificate and prevents a lucky single-number answer from passing.
 */
export function mc2004RevisionReference(){
  const histogram=Array(5).fill(0) as number[];
  const byFirst=Array(3).fill(0) as number[];
  const visit=(s:CountState)=>{
    const pos=s.zeros+s.ones+s.twos;
    if(pos===10){
      histogram[s.mod]++;
      if(s.mod===2)byFirst[s.first]++;
      return;
    }
    for(const digit of [0,1,2]){
      const zeros=s.zeros+(digit===0?1:0),ones=s.ones+(digit===1?1:0),twos=s.twos+(digit===2?1:0);
      if(zeros>4||ones>3||twos>3||twos>ones||(digit===2&&s.last===2))continue;
      visit({zeros,ones,twos,last:digit,mod:(s.mod+(pos+1)*digit)%5,first:pos===0?digit:s.first});
    }
  };
  visit({zeros:0,ones:0,twos:0,last:-1,mod:0,first:-1});
  return {total:histogram[2],by_first:byFirst,residue_histogram:histogram};
}

export function buildMc2004Revision():MathCase{
  return {
    id:'MC2-004-R1',dimension:'reasoning_math',family:'bounded-prefix-modular-counting',
    title:'前缀约束与模条件计数（可核验证书版）',
    task:'长度 10 的字符串由 0、1、2 组成，恰有 4 个 0、3 个 1、3 个 2；每个前缀中 1 的数量不少于 2 的数量，且不得出现相邻 22。位置从 1 编号，计算所有“位置编号×该位数字”之和除以 5 的余数。输出 total（余数为 2 的字符串数）、by_first（这些字符串按首位 0、1、2 分组的数量）和 residue_histogram（所有满足字符数与前缀/相邻约束的字符串，按余数 0、1、2、3、4 分组的数量）。三个字段必须相互一致；相同字符不带标签。',
    data:{length:10,counts:{'0':4,'1':3,'2':3},modulus:5,targetRemainder:2},
    reference:mc2004RevisionReference(),
  };
}

export function gradeMc2004Revision(answer:unknown):ChallengeGrade{
  const c=buildMc2004Revision();
  if(!exactKeys(answer,['total','by_first','residue_histogram']))return result(c.id,[],false,'Response keys do not match the task');
  const byFirst=exactIntegerArray(answer.by_first),histogram=exactIntegerArray(answer.residue_histogram);
  const ref=c.reference as {total:number;by_first:number[];residue_histogram:number[]};
  const checks=[
    {id:'total',pass:numericEqual(answer.total,ref.total)},
    {id:'by_first',pass:!!byFirst&&byFirst.length===3&&byFirst.every((n,i)=>n===ref.by_first[i])},
    {id:'residue_histogram',pass:!!histogram&&histogram.length===5&&histogram.every((n,i)=>n===ref.residue_histogram[i])},
    {id:'certificate_consistency',pass:!!byFirst&&!!histogram&&byFirst.reduce((a,b)=>a+b,0)===histogram[2]&&numericEqual(answer.total,histogram[2])},
  ];
  return result(c.id,checks);
}
