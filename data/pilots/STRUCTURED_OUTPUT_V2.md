# 结构化输出 v2 校准题包

`structured-output-v2.json` 是 12 类任务、每类 3 个边界变体的开发题包（36 题）。
`structured-output-v2-gold.json` 保存程序生成的期望 JSON，供离线评分器审计使用。
`structured-output-v2-repairs.json` 是 SO-CN-042、SO-CN-047 的前瞻性修订。
36 道开发题及其 gold 尚未写入正式题库或数据库。两道旧题修订已于 2026-09-26 随正式题库 1.48.0 发布；58 道现有结构化输出题均标记为评分器 v6。已完成测评的快照与成绩保持原样。
首批 12 道现有题的合同规则补强随正式题库 1.49.0 发布；开发候选保留在 `structured-output-contract-repair.json`，可用 `scripts/build-structured-output-contract-repair.mjs` 重建。该批主要修补判分覆盖，尚不能证明模型间区分度提高。

生成：先构建 `@zxbench/core`，再运行
`node scripts/build-structured-output-pilot.mjs` 与
`node scripts/build-structured-output-repairs.mjs`。

v2 评分器逐条输出 `structured_*` 约束审计；所有已声明检查均通过才算严格通过。
加权分仍保留作故障诊断，但失败答案的确定性分最高为 99。
`jsonEq` 对 JSON 对象键序不敏感，对数组顺序敏感。

正式发布前的校准顺序：

1. 用各题 gold、合法的键序变体和按要求逐项制造的错误验证评分器；任何有效答案误扣或错误答案漏判都阻止发布。
2. 当前长评测结束后，选不同模型家族和能力档位在开发题包上试跑。按任务类别汇总，保留能揭示稳定差异且无评分争议的题。
3. 将校准后选定的新题同步写入正式题库与数据库，更新版本及哈希，然后启动新的正式运行。两道旧题修订已先行发布。旧运行和题包快照保持原样；新旧版本不得合并为同一排行榜口径。

36 题的程序答案与错误变体验证只是评分器检查；尚不构成模型间区分度校准。
