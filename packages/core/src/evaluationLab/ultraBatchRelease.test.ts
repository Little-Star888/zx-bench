import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildEvidenceExam, gradePart as gradeEvidencePart, referenceOutput as evidenceReference } from './evidenceExam/index.js';
import { buildExamPaper as buildMathExpansion } from './examExpansion/index.js';
import { ULTRA_MATH_RUBRICS } from './ultraMathRubric.js';

const manifest=JSON.parse(readFileSync('data/scenarios/ultra-batch-release-manifest.json','utf8'));

describe('three-dimension ultra batch release',()=>{
  it('publishes twelve four-part groups in every target dimension',()=>{
    expect(manifest.structure).toMatchObject({dimensions:3,groupsPerDimension:12,partsPerGroup:4,groups:36,parts:144});
    expect(manifest.dimensions.reasoning_math.groups).toHaveLength(12);
    expect(manifest.dimensions.data_extraction.groups).toHaveLength(12);
    expect(manifest.dimensions.hallucination_resistance.groups).toHaveLength(12);
    expect(manifest.dimensions.reasoning_math.groups.map((x:{id:string})=>x.id)).not.toContain('MX3-06');
    expect(manifest.dimensions.reasoning_math.groups.map((x:{id:string})=>x.id)).not.toContain('MX3-12');
  });

  it('binds every evidence group to a frozen executable paper and replays all references',()=>{
    const paper=buildEvidenceExam(),ids=new Set(paper.parts.map(x=>x.groupId));
    expect([...new Set(paper.parts.filter(x=>x.dimension==='data_extraction').map(x=>x.groupId))].sort()).toEqual([...manifest.dimensions.data_extraction.groups].sort());
    expect([...new Set(paper.parts.filter(x=>x.dimension==='hallucination_resistance').map(x=>x.groupId))].sort()).toEqual([...manifest.dimensions.hallucination_resistance.groups].sort());
    expect(ids.size).toBe(24);
    for(const part of paper.parts)expect(gradeEvidencePart(part,evidenceReference(part)).earned).toBe(part.points);
  });

  it('binds the selected math groups and keeps rejected capstones out',()=>{
    const entries=manifest.dimensions.reasoning_math.groups as {id:string;source:string}[],selected=entries.map(x=>x.id),expansion=buildMathExpansion();
    const expansionIds=new Set(expansion.parts.map(x=>x.groupId));
    const ultraIds=new Set(ULTRA_MATH_RUBRICS.map(x=>x.groupId));
    for(const id of selected)expect(expansionIds.has(id)||ultraIds.has(id as 'UMX-01'|'UMX-02')).toBe(true);
    expect(new Set(entries.filter(x=>x.id.startsWith('MX3-')).map(x=>x.source))).toEqual(new Set([expansion.policy.version]));
  });

  it('does not serialize coordinator gold or explicit answer labels into model questions',()=>{
    const evidence=buildEvidenceExam(),selected=new Set(manifest.dimensions.reasoning_math.groups.map((x:{id:string})=>x.id));
    const questions=[...evidence.questions,...buildMathExpansion().questions.filter(x=>selected.has(x.id.replace(/-P[1-4]$/,'')))];
    for(const question of questions){
      const prompt=question.messages.map(x=>x.content).join('\n');
      expect(prompt).not.toMatch(/referenceAnswer|referenceOutput|正确答案|答案是|"expected"/i);
    }
  });
});
