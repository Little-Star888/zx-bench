/**
 * MX3 高难度题组退役清单（2026-09-17）。
 *
 * 依据与既有 `challengeRetirement.ts` **不同**，必须分开记录：
 *
 *   challengeRetirement.ts 用的是**官方判别度门禁**的 foundation 定义
 *   ——「所有被观测模型都通过」，受 maxFoundationRate ≤ 20% 约束（跨模型无区分）。
 *
 *   本清单用的是**用户指定的判据**：「连 27B 本地模型都每次都满分」。
 *   这两者不等价：一个题可以「27B 次次满分」却仍然能分开更弱的模型
 *   （RM-CN 家族就是这样：27B 全对，但门禁算出 allPassItems = 0 / separatingRate = 94.1%）。
 *
 * 本次退役范围由用户明确指定：只清 MX3-21/22/23 三组（12 小问），暂不补题。
 * 理由：这三组是**按「高难度」新出/改写**的（MX3-22/23 更是因为原版在 tools=false
 * 下不可达而刚被重写过），设计意图就是拉开梯度；27B 在 12 问上全部满分
 * ⇒ 设计意图未达成，用户明确表示不要。
 *
 * 逐题证据（apps/data/zxbench.db，modelConfigId = 086461bc-49c6-4bd6-b4b8-f8260be0f71f，
 * qwen3.8-27b-nvfp4，已排除 HARD_TIME_LIMIT / Unknown 等工程失败行）：
 *   MX3-21-P1..P4   1~2 次 run，全部 100
 *   MX3-22-P1..P4   1~3 次 run，全部 100（改写前 P2 是 600s 超时+零输出的 0 分）
 *   MX3-23-P1..P4   1 次 run，全部 100
 *   对照 MX3-24：P1/P2/P3 = 100，**P4 = 0**（唯一有区分信号的一问）⇒ 该组保留不动。
 *
 * 退役只改 `status`（benchmark.json 与 DB 的运行时选取依据），**题包仍保留这三组的定义**
 * （与 challengeRetirement 的既有约定一致），题目定义、参考答案与历史 run 行全部保留，可随时回滚。
 */
export const RETIRED_EXAM_GROUP_IDS = [
  'MX3-21-P1', 'MX3-21-P2', 'MX3-21-P3', 'MX3-21-P4',
  'MX3-22-P1', 'MX3-22-P2', 'MX3-22-P3', 'MX3-22-P4',
  'MX3-23-P1', 'MX3-23-P2', 'MX3-23-P3', 'MX3-23-P4',
] as const;

export const RETIRED_EXAM_GROUP_ID_SET = new Set<string>(RETIRED_EXAM_GROUP_IDS);

/** 退役依据摘要，写入 meta 供审计 */
export const EXAM_GROUP_RETIREMENT_REASON =
  'saturated against the local 27B model: every run scored 100, so the group no longer '
  + 'discriminates the model it was authored for (user decision, 2026-09-17)';

/** 用户明确要求：本轮只清这三组，暂不补题 */
export const EXAM_GROUP_RETIREMENT_SCOPE =
  'user-selected: MX3-21/22/23 only (12 parts); no replacement authored in this round';
