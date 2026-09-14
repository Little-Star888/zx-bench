import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
import { buildUltraMathQuestions } from './ultraMathQuestions.js';

describe('ultra math question-only export',()=>{
  it('extracts eight isolated prompts from the reviewed paper without coordinator text',()=>{
    const pack=buildUltraMathQuestions(readFileSync('docs/ultra-math-2026-09-14-questions.md','utf8'));
    expect(pack.questions).toHaveLength(8);
    expect(pack.questions.map(x=>x.id)).toEqual(['UMX-01-P1','UMX-01-P2','UMX-01-P3','UMX-01-P4','UMX-02-P1','UMX-02-P2','UMX-02-P3','UMX-02-P4']);
    for(const q of pack.questions){
      expect(q.messages[0].content).not.toMatch(/详细评分细则|精确答案|Qwen|DeepSeek|使用边界/);
      expect(q.messages[0].content).not.toMatch(/下一问|第四问：全部层级/);
    }
  });
});
