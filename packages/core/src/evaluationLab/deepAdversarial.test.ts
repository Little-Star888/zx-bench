import { describe, expect, it, vi } from 'vitest';
import { runDeepAdversarialAudit, summarizeExecutionIsolation, PR_CONTROL_SCENARIO, PR_ADVERSARIAL_CONTROLS } from './deepAdversarial.js';
import { readFileSync } from 'node:fs';
import { llmJudgeEvaluator, prRuleDiagnosticEvaluator } from '../evaluators/llmJudge.js';
import { instructionChecklistEvaluator } from '../evaluators/instructionChecklist.js';
import { callModel } from '../model/caller.js';
import { computeDifficultyWeightedDimAvgs } from '../scoring.js';
vi.mock('../model/caller.js', () => ({ callModel: vi.fn() }));
describe('stage 1: bounded red-team checks and honest release gates', () => {
  it('derives runtime migration coverage from actual bank contracts, not constants or fixture count',()=>{
    const bank=JSON.parse(readFileSync('data/scenarios/benchmark.json','utf8'));
    const coverage=summarizeExecutionIsolation(bank);
    expect(coverage.totalCodeRepair).toBe(coverage.migratedQuestions+coverage.pendingCodeRepair+coverage.ruleOnlyNoBug);
    expect(coverage.migratedQuestions).toBe(107);expect(coverage.pendingCodeRepair).toBe(0);
    expect(coverage.ruleOnlyNoBug).toBe(20);expect(coverage.projectRepairDevelopment).toBe(20);
    expect(coverage.projectRepairExecutableDevelopment).toBe(20);
    expect(coverage.projectRepairOfficialEligible).toBe(0);
    expect(coverage.prExecutableEvidence).toBe(2);
    expect(coverage.lightweightTrustFoundationReady).toBe(true);
    const missing=structuredClone(bank);
    delete missing.find((s:any)=>s.id==='CP-L1-JS-001').requirements.isolatedJson;
    expect(summarizeExecutionIsolation(missing).migratedQuestions).toBe(106);
    delete missing.find((s:any)=>s.id==='CP-L1-JS-002').requirements.quickJsObservation;
    expect(summarizeExecutionIsolation(missing).migratedQuestions).toBe(105);
    expect(summarizeExecutionIsolation([]).pendingCodeRepair).toBe(0);
  });
  it('maintains paired controls without claiming quarantine solves semantics', async () => {
    const bank=JSON.parse(readFileSync('data/scenarios/benchmark.json','utf8'));
    const meta=JSON.parse(readFileSync('data/scenarios/benchmark-meta.json','utf8'));
    const report = await runDeepAdversarialAudit(bank,meta);
    expect(report.results).toHaveLength(17);
    expect(report.open).toEqual([]);
    expect(report.releaseReady).toBe(true);
    expect(report.reliabilityGateSatisfied).toBe(true);
    expect(report.challengeSupplementReady).toBe(true);
    expect(report.scorePublicationReady).toBe(true);
    expect(report.independentHumanGold).toBe(false);
    expect(callModel).not.toHaveBeenCalled();
  });
  it.each(PR_ADVERSARIAL_CONTROLS)('$id cannot become a main capability score from lexical/Judge signals', async c => {
    const r = await llmJudgeEvaluator.evaluate(PR_CONTROL_SCENARIO, c.output, {} as any, undefined, {} as any);
    expect(r.environmentError).toBe(true);
    expect(r.axisCoverage).toBe(0);
    expect(r.humanReviewRequired).toBe(true);
    expect(r.totalScore).toBe(0);
    expect(r.evidence?.[0]).toContain('SEMANTIC_VERIFIER_UNAVAILABLE');
    expect(callModel).not.toHaveBeenCalled();
  });
  it('keeps the wrong-fix vulnerability visible in diagnostic evidence', async () => {
    const c = PR_ADVERSARIAL_CONTROLS.find(c => c.id === 'pr-wrong-fix')!;
    const diagnostic = await prRuleDiagnosticEvaluator.evaluate(PR_CONTROL_SCENARIO, c.output, {} as any);
    expect(diagnostic.totalScore).toBe(100); // Known limitation, NOT a correctness assertion.
    const official = await llmJudgeEvaluator.evaluate(PR_CONTROL_SCENARIO, c.output, {} as any);
    expect(official.axisScores).toBeUndefined();
    expect(official.evidence?.[1]).toContain('PR_RULE_DIAGNOSTIC:');
  });
  it('isolates pending PR scores from numeric dimension aggregation', async () => {
    const r = await llmJudgeEvaluator.evaluate(PR_CONTROL_SCENARIO, PR_ADVERSARIAL_CONTROLS[0].output, {} as any);
    const scores = computeDifficultyWeightedDimAvgs([{scenarioId:'pr',dimension:'program',totalScore:0,environmentError:r.environmentError},
      {scenarioId:'code',dimension:'program',totalScore:80}], new Map());
    expect(scores.get('program')).toBe(80);
  });
  it('a quoted rejected example cannot replace the actual plan, while a valid actual plan still passes', async () => {
    const s = {requirements:{constraints:[{id:'order',type:'ordered_inclusion',check:{steps:[['新增列'],['双写'],['回填'],['切读'],['删除旧列']]}}]}} as any;
    const prefix = '不采用的旧方案：删除旧列、切读、回填、双写、新增列。我的实际操作：';
    const good = await instructionChecklistEvaluator.evaluate(s,prefix+'新增列、双写、回填、切读、删除旧列。',{} as any);
    const bad = await instructionChecklistEvaluator.evaluate(s,prefix+'删除旧列、切读、回填、双写、新增列。',{} as any);
    expect(good.criterionResults?.[0].status).toBe('pass');
    expect(bad.criterionResults?.[0].status).toBe('fail');
  });
});
