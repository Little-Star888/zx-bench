import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskContract, reuseDecision, strictSuccess, hasExecutionEvidence } from './lib/execution-task-pack.mjs';
const task = { id: 'cli', promptTemplate: 'fix', requirements: { executionImageId: 'sha256:x',
  executionCases: [{ files: [{ path: 'a', content: 'x' }], expectedFiles: { b: 'y' } }] } };
const contract = s => taskContract(s, 'engine', 'grader');
test('outcome changes regrade; observation, image and budget changes rerun', () => {
  const before = contract(task);
  const expected = structuredClone(task); expected.requirements.executionCases[0].expectedFiles.b = 'z';
  assert.equal(reuseDecision(before, contract(expected)), 'regrade');
  for (const change of [s => s.promptTemplate = 'new task',
    s => s.requirements.executionCases[0].files[0].content = 'new input',
    s => s.requirements.executionImageId = 'sha256:y',
    s => s.maxAnswerTokens = 100]) {
    const next = structuredClone(task); change(next);
    assert.equal(reuseDecision(before, contract(next)), 'rerun');
  }
  assert.equal(reuseDecision(before, taskContract(task, 'changed engine', 'grader')), 'rerun');
  assert.equal(reuseDecision(before, taskContract(task, 'engine', 'changed grader')), 'regrade');
});
test('metadata reuse requires actual prior evidence; source is not mutated', () => {
  const copy = structuredClone(task);
  assert.equal(reuseDecision(contract(task), contract({ ...task, status: 'retired' })), 'reuse');
  assert.equal(reuseDecision(undefined, contract(task)), 'rerun');
  assert.equal(reuseDecision(contract(task), contract(task), false), 'rerun');
  assert.deepEqual(task, copy);
});
test('critical failures and environment errors cannot become strict success', () => {
  assert.equal(strictSuccess({ totalScore: 100, environmentError: true }), false);
  assert.equal(strictSuccess({ totalScore: 100, criterionResults: [{ critical: true, status: 'fail' }] }), false);
  assert.equal(strictSuccess({ totalScore: 100 }), true);
});
test('final text cannot substitute for a live interaction trace', () => {
  const world = { requirements: { executionWorld: {} } };
  assert.equal(hasExecutionEvidence(world, { modelOutput: 'done' }), false);
  assert.equal(hasExecutionEvidence(world, { outputMetadata: { executionWorldTrace: { events: [], finalState: {} } } }), true);
  assert.equal(hasExecutionEvidence(task, { modelOutput: 'true' }), true);
});
