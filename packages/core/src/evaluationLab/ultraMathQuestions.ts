import { snapshotHash } from '../contracts/pack.js';
import { ULTRA_MATH_RELEASE, ULTRA_MATH_RUBRICS } from './ultraMathRubric.js';

const numerals=['第一问','第二问','第三问','第四问'];

export function buildUltraMathQuestions(markdown:string){
  const headings=[...markdown.matchAll(/^## (UMX-\d+)[：:]\s*(.+)$/gm)];
  if(headings.length!==2)throw new Error('Expected exactly two UMX groups');
  const questions=[] as {id:string;groupId:string;number:number;points:number;hardSeconds:number;messages:{role:'user';content:string}[];questionHash:string}[];
  for(let gi=0;gi<headings.length;gi++){
    const match=headings[gi],groupId=match[1],title=match[2].trim();
    const start=match.index!+match[0].length,end=headings[gi+1]?.index??markdown.search(/^## 使用边界/m);
    const body=markdown.slice(start,end<0?markdown.length:end).trim(),partHeads=[...body.matchAll(/^### (第[一二三四]问)[：:]\s*(.+)$/gm)];
    if(partHeads.length!==4)throw new Error(`Expected four parts for ${groupId}`);
    const shared=body.slice(0,partHeads[0].index).trim();
    for(let i=0;i<4;i++){
      if(partHeads[i][1]!==numerals[i])throw new Error(`Unexpected part order for ${groupId}`);
      const taskStart=partHeads[i].index!+partHeads[i][0].length,taskEnd=partHeads[i+1]?.index??body.length;
      const rubric=ULTRA_MATH_RUBRICS.find(x=>x.id===`${groupId}-P${i+1}`);if(!rubric)throw new Error('Missing rubric');
      const content=`${title}，第${i+1}/4问，${rubric.points}分，时限${rubric.hardSeconds}秒。\n共同题干：\n${shared}\n本问：\n${body.slice(taskStart,taskEnd).trim()}\n只提交本问结论与可核查证明。不得使用网络或执行程序；前问未完成也可继续，未来小问不会提供。`;
      const q={id:rubric.id,groupId,number:i+1,points:rubric.points,hardSeconds:rubric.hardSeconds,messages:[{role:'user' as const,content}]};
      questions.push({...q,questionHash:snapshotHash(q)});
    }
  }
  const publicQuestions=questions.map(({groupId:_,number:__,points:___,hardSeconds:____,...q})=>q);
  return {version:ULTRA_MATH_RELEASE.questionVersion,questions,publicQuestions,contractHash:snapshotHash({version:ULTRA_MATH_RELEASE.questionVersion,questions})};
}
