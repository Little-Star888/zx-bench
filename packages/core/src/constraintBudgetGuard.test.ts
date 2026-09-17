// ============================================================
// token 预算守卫（2026-09-17）
//
// 背景：排查「DE-CN-047 三次 run 都恒 0 分」时发现，题级 `maxAnswerTokens`
// 会**静默顶掉运行级 `maxTokens``，是一条隐藏的预算覆盖：
//   · packages/core/src/orchestrator.ts:75
//        if (scenario.maxAnswerTokens != null) c.maxAnswerTokens = scenario.maxAnswerTokens;
//   · packages/core/src/model/caller.ts:382-387（发包前重算，**不是兜底**）
//        let defaultMaxTokens = params.maxTokens ?? (isReasoningModel ? 32768 : 8192);
//        if (constraints?.maxTotalTokens) defaultMaxTokens = constraints.maxTotalTokens;
//        else if (constraints?.maxReasoningTokens || constraints?.maxAnswerTokens)
//          defaultMaxTokens = (constraints.maxReasoningTokens ?? 0) + (constraints.maxAnswerTokens ?? 0);
//   · packages/core/src/model/caller.ts:41 / :86  → body.max_tokens = defaultMaxTokens
//   · packages/core/src/model/caller.ts:544-546   → 还会把「最终答案必须控制在 N 个 token 以内」拼进 prompt
//
// 后果（实测）：`DE-CN-036..056` 这 21 题在 2026-09-12 被打上 `maxAnswerTokens: 1024`
// （旧 `answerFirst` 口径的遗留值），于是**每次调用实发 max_tokens = 0 + 1024 = 1024**；
// 对推理模型，1024 会被 reasoning 先吃光 ⇒ `finishReason=length`、`content` 为空 ⇒ 恒 0 分。
// 修复：把这 21 题改为 `null`（落回运行级 maxTokens）；脚本 `scripts/fix-de-answer-token-cap.mjs`。
//
// 本文件两部分：
//  A. **引擎契约**（行为测试）：把「题级上限会顶掉运行级预算」这条语义钉住，
//     使这条耦合不可能再被无声地忽略。若将来引擎改成「分档取大」，
//     这些断言会失败 —— 那是**好信号**，届时请同步放宽/删除 B 部分的数据守卫。
//  B. **题库数据守卫**：题级上限不得低于安全下限；被修复的那批必须保持 null。
// ============================================================
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ModelConfig, ModelParams, Scenario, ScenarioTier } from '@zxbench/types';
import { callModel } from './model/caller.js';

/** caller.ts 里 NORMAL_DEFAULT_TOKENS 的值；题级上限低于它一定是废口径遗留 */
const SAFE_MIN_BUDGET = 8192;
const RUN_LEVEL_MAX_TOKENS = 98192;
const FIXED_IDS = Array.from({ length: 21 }, (_, i) => `DE-CN-${String(36 + i).padStart(3, '0')}`);

const bank = JSON.parse(readFileSync('data/scenarios/benchmark.json', 'utf8')) as Scenario[];

const config = {
  id: 'probe', name: 'probe-model', provider: 'probe',
  baseUrl: 'http://127.0.0.1:9/v1', reasoningModel: true,
} as unknown as ModelConfig;

/** 桩掉 fetch，把实际下发的请求体抓出来 */
async function captureRequest(constraints: Parameters<typeof callModel>[0]['constraints'], params: ModelParams) {
  const bodies: Record<string, unknown>[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return {
      ok: true, status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      }),
      text: async () => '',
    } as unknown as Response;
  }) as unknown as typeof fetch;
  try {
    await callModel({ config, params, userPrompt: '输出 JSON', constraints });
  } finally {
    globalThis.fetch = original;
  }
  expect(bodies).toHaveLength(1);
  const body = bodies[0] as { max_tokens: number; messages: { role: string; content: string }[] };
  return { maxTokens: body.max_tokens, prompt: body.messages.map((m) => m.content).join('\n') };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('题级 token 上限对运行级预算的影响（引擎契约）', () => {
  it('没有 token 约束时，实发 max_tokens 就是运行级 maxTokens', async () => {
    const { maxTokens } = await captureRequest(undefined, { maxTokens: RUN_LEVEL_MAX_TOKENS });
    expect(maxTokens).toBe(RUN_LEVEL_MAX_TOKENS);
  });

  it('题级只给 maxAnswerTokens 时，它会（静默地）顶掉运行级 maxTokens', async () => {
    const { maxTokens } = await captureRequest({ maxAnswerTokens: 1024 }, { maxTokens: RUN_LEVEL_MAX_TOKENS });
    // 正是 DE-CN-047 恒 0 分的原因：想给「答案」留 1024，实际把**全部**预算压到 1024，
    // 而推理模型的 reasoning 会先把这 1024 吃掉，content 永远为空。
    expect(maxTokens).toBe(1024);
    expect(maxTokens).toBeLessThan(RUN_LEVEL_MAX_TOKENS);
  });

  it('同时给 reasoning 与 answer 上限时，两者相加才是实发预算', async () => {
    const { maxTokens } = await captureRequest({ maxReasoningTokens: 393216, maxAnswerTokens: 393216 }, { maxTokens: RUN_LEVEL_MAX_TOKENS });
    expect(maxTokens).toBe(786432);
  });

  it('maxTotalTokens 优先级最高，直接决定实发预算', async () => {
    const { maxTokens } = await captureRequest({ maxTotalTokens: 50000, maxAnswerTokens: 1024 }, { maxTokens: RUN_LEVEL_MAX_TOKENS });
    expect(maxTokens).toBe(50000);
  });

  it('题级上限非空时，旧口径软指令会被拼进 prompt（这也是那次 1024 的出处）', async () => {
    const { prompt } = await captureRequest({ maxAnswerTokens: 1024 }, { maxTokens: RUN_LEVEL_MAX_TOKENS });
    expect(prompt).toContain('最终答案必须控制在 1024 个 token');
  });
});

describe('题库 token 上限数据守卫', () => {
  const effectiveBudget = (s: Scenario): number | null => {
    if (s.maxAnswerTokens == null && s.maxReasoningTokens == null) return null;
    return (s.maxReasoningTokens ?? 0) + (s.maxAnswerTokens ?? 0);
  };

  it('没有任何题把模型预算压到安全下限以下（旧 answerFirst 口径已废弃）', () => {
    const offenders = bank
      .map((s) => ({ id: s.id, budget: effectiveBudget(s), answer: s.maxAnswerTokens, reasoning: s.maxReasoningTokens }))
      .filter((x) => x.budget != null && x.budget < SAFE_MIN_BUDGET);
    expect(offenders, `以下题目的题级上限会把实发 max_tokens 压到 ${SAFE_MIN_BUDGET} 以下：\n${JSON.stringify(offenders, null, 1)}`)
      .toEqual([]);
  });

  it('DE-CN-036..056 不带题级答案上限（2026-09-17 修复的回归锁）', () => {
    const rows = bank.filter((s) => FIXED_IDS.includes(s.id));
    expect(rows).toHaveLength(21);
    const stillCapped = rows.filter((s) => s.maxAnswerTokens != null).map((s) => ({ id: s.id, maxAnswerTokens: s.maxAnswerTokens }));
    expect(stillCapped, `这些题又被打上题级答案上限了：${JSON.stringify(stillCapped)}`).toEqual([]);
    // 顺带锁住：它们仍然是受审的 v3 data_extraction 契约
    for (const row of rows) {
      expect(row.dimension).toBe('data_extraction');
      expect(row.grader).toBe('json_atomic_fields');
      expect(row.tier).toBe<ScenarioTier>('public_dev');
    }
  });
});
