/** Offline authoring/grading only: no provider imports, credentials, or model calls. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildEvidenceExam, referenceOutput, scoreExam } from '../evaluationLab/evidenceExam/index.js';
import { snapshotHash } from '../contracts/pack.js';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const [mode,...args]=process.argv.slice(2),paper=buildEvidenceExam();
const read=(p:string)=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const save=(p:string,v:unknown)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const files=['packages/core/src/evaluationLab/evidenceExam/index.ts','packages/core/src/evaluationLab/evidenceExam/rules.ts','packages/core/src/evaluationLab/evidenceExam/temporal.ts',
  'packages/core/src/scripts/evidence-exam.ts','packages/core/src/evaluationLab/examPaper/index.ts','packages/core/src/evaluationLab/methodsV2/verify.ts','packages/core/src/evaluationLab/challengeTypes.ts','packages/core/src/contracts/pack.ts'];
const hashes=()=>Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(join(root,p))).digest('hex')]));
if(mode==='export'&&args.length===1){
  const dir=resolve(root,args[0]);mkdirSync(dir);mkdirSync(join(dir,'coordinator'));
  const publicPack={contractHash:paper.contractHash,questions:paper.questions};
  save(join(dir,'candidate-questions.json'),publicPack);save(join(dir,'coordinator/frozen-pack.json'),paper);
  save(join(dir,'coordinator/reference-answers-not-model.json'),{contractHash:paper.contractHash,runId:'reference',modelId:'reference',modelFamily:'reference',answers:paper.parts.map(p=>({id:p.id,questionHash:p.question.questionHash,outcome:'completed',output:referenceOutput(p)}))});
  save(join(dir,'manifest.json'),{codeFiles:hashes(),contractHash:paper.contractHash,publicHash:snapshotHash(publicPack),modelCalls:0,questions:8});
  save(join(dir,'submission-template.json'),{contractHash:paper.contractHash,runId:'REPLACE',modelId:'REPLACE',modelFamily:'REPLACE',answers:[]});
  writeFileSync(join(dir,'题面.md'),'# 数据提取与幻觉抵抗候选大题\n\n'+paper.questions.map(q=>'## '+q.id+'\n\n'+q.messages[0].content).join('\n\n'),{flag:'wx'});
  console.log(JSON.stringify({directory:dir,groups:2,questions:8,modelCalls:0}));
}else if(mode==='grade'&&args.length===3){
  const dir=resolve(root,args[0]),manifest=read(join(dir,'manifest.json')),frozen=read(join(dir,'coordinator/frozen-pack.json'));
  if(snapshotHash(manifest.codeFiles)!==snapshotHash(hashes())||snapshotHash(frozen)!==snapshotHash(paper)||manifest.contractHash!==paper.contractHash||manifest.publicHash!==snapshotHash(read(join(dir,'candidate-questions.json'))))throw Error('Frozen candidate mismatch');
  const result=scoreExam(paper,read(args[1]));save(resolve(root,args[2]),result);console.log(JSON.stringify(result.dimensions));
}else throw Error('Usage: evidence-exam export NEW_DIRECTORY | grade PACK_DIRECTORY SUBMISSION NEW_RESULT. No model execution.');
