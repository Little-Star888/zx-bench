/** Offline federation export. It never imports provider configuration or calls a model. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotHash } from '../contracts/pack.js';
import { buildEvidenceExam, referenceOutput as evidenceReference } from '../evaluationLab/evidenceExam/index.js';
import { buildExamPaper as buildMathExpansion, referenceOutput as mathReference } from '../evaluationLab/examExpansion/index.js';
import { buildUltraMathQuestions } from '../evaluationLab/ultraMathQuestions.js';
import { ULTRA_MATH_RUBRICS } from '../evaluationLab/ultraMathRubric.js';

const root=fileURLToPath(new URL('../../../../',import.meta.url)),mode=process.argv[2],target=process.argv[3];
if(mode!=='export'||!target)throw new Error('Usage: ultra-batch export NEW_DIRECTORY');
const out=resolve(root,target),manifest=JSON.parse(readFileSync(join(root,'data/scenarios/ultra-batch-release-manifest.json'),'utf8'));
const selectedMath=new Set(manifest.dimensions.reasoning_math.groups.map((x:{id:string})=>x.id));
const evidence=buildEvidenceExam(),expansion=buildMathExpansion({groupIds:[...selectedMath].filter(x=>x.startsWith('MX3-'))});
const ultra=buildUltraMathQuestions(readFileSync(join(root,'docs/ultra-math-2026-09-14-questions.md'),'utf8'));
const questions=[
  ...ultra.questions.map(x=>({...x,dimension:'reasoning_math'})),
  ...expansion.parts.map(x=>({id:x.id,groupId:x.groupId,number:x.number,points:x.points,hardSeconds:x.hardSeconds,dimension:'reasoning_math',messages:x.question.messages,questionHash:x.question.questionHash})),
  ...evidence.parts.map(x=>({id:x.id,groupId:x.groupId,number:x.number,points:x.points,hardSeconds:x.hardSeconds,dimension:x.dimension,messages:x.question.messages,questionHash:x.question.questionHash})),
];
if(questions.length!==144||new Set(questions.map(x=>x.id)).size!==144)throw new Error('Unexpected federated question count');
mkdirSync(out);mkdirSync(join(out,'coordinator'));
const save=(name:string,value:unknown)=>writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const publicPack={version:manifest.version,questions:questions.map(({messages,...x})=>({...x,messages}))};
save('candidate-questions.json',publicPack);
save('manifest.json',{version:manifest.version,releaseManifestHash:createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),publicHash:snapshotHash(publicPack),groups:36,questions:144,modelCalls:0});
save('coordinator/evidence-reference.json',{contractHash:evidence.contractHash,answers:evidence.parts.map(p=>({id:p.id,questionHash:p.question.questionHash,output:evidenceReference(p)}))});
save('coordinator/math-expansion-reference.json',{contractHash:expansion.contractHash,answers:expansion.parts.map(p=>({id:p.id,questionHash:p.question.questionHash,output:mathReference(p)}))});
save('coordinator/ultra-math-rubrics.json',{contractHash:ultra.contractHash,rubrics:ULTRA_MATH_RUBRICS});
writeFileSync(join(out,'题面.md'),'# 三维超高难度递进题集\n\n'+questions.map(q=>`## ${q.id}\n\n${q.messages[0].content}`).join('\n\n'),{flag:'wx'});
console.log(JSON.stringify({directory:out,groups:36,questions:144,modelCalls:0}));
