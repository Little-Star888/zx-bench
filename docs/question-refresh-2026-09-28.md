# 结构化输出与 Docker 题库更新

本次提交包含当前结构化输出题库（60 道有效正式题）、189 道源题对应的 306 个 Docker 执行实例，以及运行时和评分器修复。开发任务仍保留 developmentShadow 标记。

题目定义位于 data/scenarios/benchmark.json 和 data/pilots/；data/execution/migration-plan.json 提供 189 → 306 映射，data/execution/tasks/ 提供原生任务包及参考解、错误反例。固定镜像需要在本地准备；并非任意机器无需准备即可运行全部题型。

本轮修复包含多行 SAY 正文保留、执行轨迹优先判分、真实时间预算与结束原因、退款说明误判、等价拒绝表达、攻击网址与真实凭据区分、Git 工作区设置和显式脚本解释器策略。题面补齐确认遗漏的路径、日期、字段、收件人和报告格式。

构建核心包：`pnpm --filter @zxbench/core build`。

运行回归：`pnpm exec vitest run packages/core/src/execution/worldLoop.test.ts packages/core/src/evaluators/executionRegrade.test.ts packages/core/src/evaluators/executionMigration.test.ts`，以及 `node --test scripts/execution-review-repairs.test.mjs scripts/execution-task-pack.test.mjs`。

隔离 Docker 参考解检查：`node scripts/check-execution-task-pack.mjs --task=CLI-CN-028-DOCKER`，或 `node scripts/check-recovery-world-docker.mjs --task=TC-CN-010-RECOVERY-0`。

GitHub 更新不等于在线数据库更新，也不会改变运行中任务的冻结题目和已加载代码。发布脚本默认检查，只有 --apply 才写数据库；遇到现有定义漂移或活动评测会拒绝覆盖。历史运行应保留原题快照，另行进行评分纠错或定向补跑。

模型答卷、校准运行日志、Signal 队列状态和本地数据库不属于本次题库发布。参考解通过不代表所有等价正确解已被穷尽验证。
