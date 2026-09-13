import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { orchestrateEvaluation } from './orchestrator.js';
import { registerEvaluator } from './evaluators/index.js';
import { prExecutableEvidenceEvaluator } from './evaluators/prExecutableEvidence.js';
import { PR_SHARDING_REFERENCE } from './evaluationLab/prWitnessSharding.js';
import { callModelWithRetry, callModel } from './model/caller.js';
import { runTieredJudge } from './judge/index.js';

vi.mock('./model/caller.js', () => ({ callModelWithRetry: vi.fn(), callModel: vi.fn() }));
vi.mock('./judge/index.js', async original => ({ ...await original<object>(), runTieredJudge: vi.fn() }));
const scenario = () => JSON.parse(readFileSync('data/scenarios/benchmark.json', 'utf8')).find((s: any) => s.id === 'PR-ELITE-013');
const options = () => ({ scenario: scenario(), modelConfig: { id: 'candidate', name: 'candidate', provider: 'local', baseUrl: 'http://unused', defaultParams: {} },
  modelParams: { maxTokens: 4096 }, evalConfig: { judgeEnabled: true }, judgeOptions: { localModel: { id: 'judge' } } } as any);

beforeEach(() => { vi.clearAllMocks(); registerEvaluator(prExecutableEvidenceEvaluator); });

it('scores a verified PR patch automatically and never calls a Judge', async () => {
  vi.mocked(callModelWithRetry).mockResolvedValue({ content: JSON.stringify(PR_SHARDING_REFERENCE), finishReason: 'stop', usage: {}, latencyMs: 1 } as any);
  const r = await orchestrateEvaluation(options());
  expect(r.totalScore).toBe(100);
  expect(r.humanReviewRequired).toBe(false);
  expect(r.graderVersion).toBe('pr_executable_evidence@1.0.0');
  expect(callModel).not.toHaveBeenCalled();
  expect(runTieredJudge).not.toHaveBeenCalled();
});

it('keeps a malformed deterministic submission at zero without creating human work', async () => {
  vi.mocked(callModelWithRetry).mockResolvedValue({ content: '{"protocol":"wrong"}', finishReason: 'stop', usage: {}, latencyMs: 1 } as any);
  const r = await orchestrateEvaluation(options());
  expect(r.totalScore).toBe(0);
  expect(r.environmentError).toBe(false);
  expect(r.humanReviewRequired).toBe(false);
  expect(runTieredJudge).not.toHaveBeenCalled();
});
