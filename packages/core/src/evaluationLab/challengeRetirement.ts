/**
 * 推理数学挑战题退役清单（2026-09-16）。
 *
 * 依据：`scripts/screen-challenge-discrimination.mjs`（官方判别度门禁）的
 * `foundation` 定义 —— 「所有被观测模型都通过」的地基题，受 `maxFoundationRate ≤ 20%` 上限约束。
 *
 * 逐题证据（apps/data/zxbench.db，按 modelConfigId 去重）：
 *   MC2-001 / MC2-002 / MC2-006   3 个模型 × 5 次 run 全部 100 分（跨模型全通过）
 *   MC2-003/005/007~012（8 题）   同一模型 3 次 run 全部 100 分，且 release manifest 自述
 *                                 「Coverage items were previously all-pass in the pilot；
 *                                  no new discrimination claim」——无区分度声明
 *   V2-595bf9608ca5bb / V2-fa3a76cee51533  同上（3 次 run 全 100）
 *
 * 对照：RM-CN 家族（34 题）在同一门禁下 `allPassItems = 0`、`separatingRate = 94.1%`，
 * 因此本次**不触碰** exact_answer_line 家族。
 *
 * 退役只改 `status`（benchmark.json / DB 的运行时选取依据），
 * 题目定义、参考答案与历史 run 行全部保留，可随时回滚。
 */
export const CHALLENGE_EXTENSION_RETIRED_IDS = [
  'MC2-003', 'MC2-005', 'MC2-007', 'MC2-008', 'MC2-009', 'MC2-010', 'MC2-011', 'MC2-012',
] as const;

export const CHALLENGE_PROBABILITY_RETIRED_IDS = [
  'V2-595bf9608ca5bb', 'V2-fa3a76cee51533',
] as const;

export const CHALLENGE_SUPPLEMENT_RETIRED_IDS = [
  'MC2-001', 'MC2-002', 'MC2-006',
] as const;

/** 全部退役 id（13 题：8 coverage + 2 probability + 3 supplement） */
export const RETIRED_REASONING_MATH_CHALLENGE_IDS = [
  ...CHALLENGE_EXTENSION_RETIRED_IDS,
  ...CHALLENGE_PROBABILITY_RETIRED_IDS,
  ...CHALLENGE_SUPPLEMENT_RETIRED_IDS,
] as const;

export const RETIRED_REASONING_MATH_CHALLENGE_ID_SET =
  new Set<string>(RETIRED_REASONING_MATH_CHALLENGE_IDS);

/** 退役依据摘要，写入 release manifest 供审计 */
export const CHALLENGE_RETIREMENT_REASON =
  'cross-run saturation: all observed models scored 100 (foundation items under the observed-discrimination policy)';
