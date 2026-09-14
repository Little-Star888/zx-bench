"""Export eight standalone question prompts; keep solutions coordinator-only.
No model requests and no automatic proof grading.
"""
import hashlib
import json
import re
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
target=ROOT/(sys.argv[1] if len(sys.argv)>1 else 'reports/ultra-math-20260914-pack-v2')
if target.exists():raise FileExistsError('Use a new export directory; do not overwrite a frozen paper.')
document=ROOT/'docs/ultra-math-2026-09-14-questions.md'
text=document.read_text(encoding='utf-8')
sections=re.split(r'(?m)^## (?=UMX-)',text)[1:]
questions=[]
for section in sections:
    section=section.split('\n## 使用边界')[0]
    stem,*parts=re.split(r'(?m)^### ',section)
    assert len(parts)==4
    group_id=stem.split('：')[0].strip()
    for number,part in enumerate(parts,1):
        points=[10,20,30,40][number-1];seconds=[360,360,1200,1200][number-1]
        question={'id':f'{group_id}-P{number}','groupId':group_id,'dimension':'reasoning_math',
                  'number':number,'points':points,'hardSeconds':seconds,
                  'messages':[{'role':'user','content':
                    f'第{number}/4问，{points}分，时限{seconds}秒。单问提交，前问得分保留。给出结论与完整推导；正确结论和证明分别计分。不访问网络、不执行程序。不要假定尚未给出的后问结论。\n\n'+stem+'\n### '+part}]}
        question['questionHash']=hashlib.sha256(json.dumps(question,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
        questions.append(question)
assert len(questions)==8
policy={'version':'ultra-math-2026-09-14-v2','modelCalls':0,'automaticModelExecution':False,
        'scoringMode':'exact-results-plus-human-proof-review','automaticProofScoring':False,
        'carryOnlyPriorSubmittedAnswers':True,'freshContextPerGroup':True,'exposeFutureParts':False,
        'answerFeedback':False,'tools':False,
        'partialCredit':True,'productionEligible':False,'difficultyMeasured':False,
        'sourceRelatedGroups':[['UMX-01','UMX-02']]}
public={'policy':policy,'questions':questions}
contract=hashlib.sha256(json.dumps(public,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
target.mkdir(parents=True);(target/'coordinator').mkdir();(target/'questions').mkdir()
def write(path,value):
    with path.open('x',encoding='utf-8') as f:json.dump(value,f,ensure_ascii=False,indent=2);f.write('\n')
index=[]
for question in questions:
    filename=f"questions/{question['id']}.json"
    write(target/filename,question)
    index.append({k:v for k,v in question.items() if k!='messages'}|{'file':filename})
write(target/'candidate-questions.json',{'contractHash':contract,'policy':policy,'questions':index})
write(target/'coordinator/assembled-paper.json',{'contractHash':contract,**public})
(target/'coordinator/审阅全卷.md').write_text(text,encoding='utf-8')
(target/'README.md').write_text('# 分问输入\n\n只读取 questions/ 下当前小问文件中的 messages 作为模型题面。同一大题可携带此前已提交答案；不得带入未来小问、金标、评分细则或判分反馈。不同大题使用全新上下文。coordinator/ 仅供出题和判卷。根目录索引不是模型输入。\n',encoding='utf-8')
base=ROOT/'reports/ultra-rank-authoring-20260914'
for name in ['answer-key.json','binary-classification.json','fixed-slice-audit.json','coordinator/rubrics.json']:
    write(target/'coordinator'/Path(name).name,json.loads((base/name).read_text(encoding='utf-8')))
(target/'coordinator/solutions.md').write_text((base/'coordinator/solutions.md').read_text(encoding='utf-8'),encoding='utf-8')
paths=[document,ROOT/'scripts/ultra-rank-oracle.py',ROOT/'scripts/ultra-extension-oracle.py',ROOT/'scripts/ultra-fixed-slice-audit.py',Path(__file__),base/'coordinator/solutions.md',base/'coordinator/rubrics.json']
write(target/'manifest.json',{'contractHash':contract,'modelCalls':0,'groups':2,'questions':8,
                             'sourceSha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}})
print(json.dumps({'directory':str(target),'questions':8,'modelCalls':0,'contractHash':contract}))
