# ZxBench · 本地大模型评测系统

[English](README.en.md) · 中文

[![CI](https://github.com/suncityldp/zx-bench/actions/workflows/ci.yml/badge.svg)](https://github.com/suncityldp/zx-bench/actions/workflows/ci.yml)

ZxBench 是本地部署的大模型评测平台，提供版本化题库、容器化编程测试、规则评分与可选 AI Judge、实时监控、断点续跑、报告和排行榜。当前题库版本为 **1.47.0**：11 个维度、815 道有效题，其中 9 道是仅可显式运行的开发影子题，默认运行 **806 道**。题目数量不等于所有题目均已通过独立金标审计或跨模型区分度验证。

## 快速开始

需要 Node.js ≥22.13、pnpm ≥11；编程题执行还需要已启动的 Docker。隔离执行所需镜像应预先准备；不同题目需要不同语言镜像，缺失镜像会报告环境未就绪，不应解释为模型能力失败。

```bash
pnpm install
pnpm --filter server prisma:generate
# 将 apps/server/.env.example 复制为 apps/server/.env，并按需配置
pnpm build
pnpm --filter server start
```

打开 <http://127.0.0.1:3001>。Windows 也可用 `start.bat` 启动；macOS/Linux 使用上面的 pnpm 命令。首次使用或题库更新后，运行 `node scripts/seed-benchmark.mjs` 导入当前 `data/scenarios/benchmark.json`。导入不会删除自建题目或历史成绩；正式评测按发布题库 ID 和内容哈希选择，不因数据库旧行而扩大范围。

## 题库与评分

题量来自 `data/scenarios/benchmark-meta.json`，下表是有效定义数，**不是每次运行的实际完成题数**。默认运行排除 9 道开发影子题（`MC2-004-R1` 和 `UMX-01/02` 各四个分题）；手动选维度、题号或运行中断也会改变覆盖范围。

| 维度 | 有效题数 | 综合分权重 |
|---|---:|---:|
| 编程 `program` | 150 | 0.17 |
| 幻觉抵抗 `hallucination_resistance` | 134 | 0.12 |
| 推理数学 `reasoning_math` | 115 | 0.12 |
| 数据抽取 `data_extraction` | 104 | 0.07 |
| 结构化输出 `structured_output` | 58 | 0.05 |
| 深度 CLI `cli_deep_tasks` | 56 | 0.07 |
| 工具/CLI `tool_cli_workflow` | 56 | 0.07 |
| 安全权限 `safety_authority` | 50 | 0.10 |
| 智能体工作流 `agent_workflow` | 45 | 0.08 |
| 指令遵循 `instruction_following` | 42 | 0.12 |
| 多轮工具闭环 `agent_loop` | 5 | 0.03 |
| **合计** | **815** | **1.00** |

每题按难度加权（easy 1、medium 1.5、hard 2、adversarial 2.5），先求维度均分，再按上表权重求综合分。规则评分器处理可确定验证的项目，语义项目可由 AI Judge 按题型规则补判；评分缺失和执行环境错误需单列，不应默认为模型零分。重试后的结果以题目尝试链中的最新有效结果为准。不同题库版本、选题范围及运行条件的总分不可直接混排。

数学精确答案题另记录**内容正确性 `content_accuracy`**：当答案内容可独立核验时，即使模型未遵守 `ANSWER:` 等输出格式，也能单独查看内容是否正确。该诊断轴**不参与综合分**；格式违规仍按正式规则扣分。只对可确定核验的题目给出此值，不把未测量题推断为正确。历史结果须与当前题目内容哈希匹配，才可补出该诊断值。

编程维度包括单文件修复、无需修复陷阱题，以及多文件工程任务。单文件 `code_repair@4.14.0` 有 107 道修复题、345 个冻结正式测试 ID；执行采用无网络、资源受限的容器或受限编译进程，期望值由宿主持有。多文件任务仍在正式范围，但部分题的正向金标覆盖不完整；容器隔离与通过测试也不等于任意仓库语义或恶意代码安全认证。详情见[发布门槛与限制](docs/lightweight-release-gate.md)。

## 使用与核验

- 创建评测可选单模型或最多 8 个不同模型的批量评测；每个模型独立运行。题目并发数为 1–4，默认 4。
- 推理模型可设置更大的生成预算、思考链上限和单题硬时限；运行级 `Max Tokens` 是请求硬上限，题级约束只能收紧它。请结合模型服务端的上下文与输出限制配置，不要把超时或环境错误混入能力比较。
- 实时监控支持暂停、恢复、取消、单题重试；报告和排行榜展示维度分及证据。批量监控可按模型切换查看。
- 用 `pnpm --filter server run:verify-score <run-id> [database-url]` 只读核验冻结题集、题级主结果、维度分和总分。需要修复旧缓存摘要时再显式使用 `--repair-summary`，它会先备份数据库。
- `pnpm test` 运行回归测试；`pnpm test:containers` 运行需要 Docker 的容器正反例检查；`pnpm build` 验证前后端构建。CI 在 push/PR 后依次安装依赖、生成 Prisma 客户端、构建、测试。

更多方法与边界见[评测可靠性实现](docs/evaluation-reliability-implementation-2026-09-09.md)、[完整性修复](docs/evaluation-integrity-fixes-2026-09.md)及[题库复核](docs/reviewed-question-bank-v5.md)。历史版本变更保留在对应 `docs/` 文档中，不作为当前题库规模或评分规则的依据。

## 项目结构

```text
apps/web/        React 前端
apps/server/     Fastify API、Prisma、WebSocket
packages/core/   调用、执行、评分、报告核心
packages/types/  共享类型
data/scenarios/  当前题库、元数据、归档与开发题
scripts/         题库导入、导出及审计工具
docs/            方法说明与截图
```

MIT License · Copyright (c) 2026 ZhiXiu Contributors
