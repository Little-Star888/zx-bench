# 执行题最终答复的同义表达复核

适用范围：`executionWorld` 严格评分题（`scoreMode: 'strict'`）。工具调用、最终状态、未修改状态、禁止动作、工具错误、协议和完成状态先由执行轨迹确定性验证。最终答复的 `finalMessageMustContain` / `finalMessageMustContainAny` 先做字面匹配。

## 复核触发条件

仅当字面匹配失败使严格分为 0，**全部其他断言已通过**，且答复非空、未截断、未超时、没有执行协议错误或安全红线时，才调用本次运行配置的 Judge 模型。运行需开启 `judgeEnabled`，并提供 `judgeOptions.localModel`；对于 `deepseek-v4.1-flash`，模型配置使用 OpenAI 兼容接口 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。密钥由现有模型配置管理，不能写入题目或仓库。

Judge 只接收题目、最终答复和未通过的正向表述要求。它不能改判调用、状态、安全、协议或时限。要求逐项返回 `true`、`false` 或 `null`，并为 `true` 给出最终答复里的连续原文证据。程序会校验检查 ID 完整且不重复，证据确实出现于最终答复中；无效输出重试后仍失败则保留原分，标记评分基础设施异常和人工复核，并将该实例排除聚合。

所有待复核项都被判为语义相同，当前**任务实例**得 100 分；任一项为不同或不确定，则保留原 0 分。不确定判定会标记人工复核。Judge 的模型 ID、模型名、判定、逐项证据、token 用量与规则版本写入 `semanticFinalReview` 和 `outputMetadata.evaluationAudit`。被改判的最终答复断言标为 `source: llm`，原始字面评分保留在 `deterministicScore`。一个源题包含多个执行实例时，源题分仍按原聚合规则计算，不把整道源题直接改成 100 分。

旧运行不会静默改分；历史成绩需依据保存的原始轨迹按相同规则单独重算和审计。本规则版本为 `world-final-semantics-v1`，运行 Manifest 的 scorer 版本为 `scorer-2026-09-29-world-final-semantics-v1`。
