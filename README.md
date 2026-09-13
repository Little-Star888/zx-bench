# ZxBench · 本地大模型评测系统

[English](README.en.md) · 中文

> 本地大模型评测平台：题库 1.31.1，10个维度、621道当前题目定义（累计699道，78道退役归档）。正式评测默认运行620道题；仅1道待实测的数学修订题处于开发影子区。题库收录不等于已证明对所有模型有区分度。

[![CI](https://github.com/suncityldp/zx-bench/actions/workflows/ci.yml/badge.svg)](https://github.com/suncityldp/zx-bench/actions/workflows/ci.yml)

## 核心特性

- **10 大能力维度**：编程、推理数学、安全权限、深度 CLI、数据抽取、智能体工作流、指令遵循、工具/CLI、幻觉抵抗、结构化输出。
- **621 道当前定义，默认正式运行620道**：包含原有150道编程题、原5道筛选挑战题和本次补入的20道默认题；仅MC2-004-R1默认排除。每题带版本与内容哈希。题目收录与区分度验证分别披露。
- **单文件编程迁移完成**：`code_repair@4.14.0` 覆盖全部107道修复题，共冻结345个正式测试ID。新增TypeScript运行时/严格类型检查，以及C、C++、Rust、Bash和最后两道JavaScript/Python宿主判分通道。
- **no_bug 陷阱题**：部分代码本身正确，模型须识别「无 bug」而非强行修改，误修会扣分。
- **确定性评分 + AI Judge 双通道**：规则评分器先判，AI Judge 按维度权重补判语义项，覆盖率感知地「让渡」权重。
- **综合分（难度加权 + 维度加权）**：高难题权重更大、按维度重要度加权求和，避免「均分」被题量带偏。
- **反拖尾**：推理模型思考链硬上限、单题硬时限（默认 300s）、超限即判，不再无限升级 token 预算。
- **实时监控 + 断点续跑**：WebSocket 实时进度、暂停/恢复/取消、单题重试、fork 分叉维度。
- **报告与排行榜**：自动聚合维度图表、AI 深度报告、模型排行榜、模型性价比散点图。
- **回归测试 + CI**：评分、聚合、金标与契约均有自动回归，GitHub Actions 自动构建并测试。

---

## 题目与真实执行（关键设计）

当前正式单文件执行通道：候选代码在无网络、受资源限制的容器或受限编译器进程内运行；期望值、类型断言及最终判决由宿主持有。107道修复题冻结345个测试ID；143个开发控制与正式题分开，不追溯改分。20道 no_bug 题仍为文本规则。两道PR题不再评自然语言评论：SQL题在隔离SQLite中重放注入与参数化修复，分片题对回滚/热点反例和迁移配置执行反事实测试；两者Judge权重均为0，普通失败不进入人工队列。

下表同时包含正式执行通道与保留的诊断执行器；是否计分以题目绑定的版本化协议为准。20道原有多文件 `project_repair` 保留在正式范围。它们已有容器隐藏测试，但正向金标覆盖仍不完整：JavaScript、Python、Go维护者风险样本已完成“原错失败、金标全通过”的回放；C#、Rust、SQL风险样本仍待补金标。该限制必须披露，但不再擅自缩减用户原有正式题量。

| 语言 | 执行后端 | 验证方式 |
|------|----------|----------|
| JavaScript / TypeScript | node:20-alpine 容器（运行测试时转译 TS） | 隐藏断言与完成证据；类型专项另有 strict 检查 |
| Python | python:3.12-alpine 容器 | assert、语法检查与完成证据 |
| Go | zxbench/go:1.21-gcc 容器 | 编译测试二进制后执行；完整固定分母，并发题可开 -race |
| Java | maven:3.9-eclipse-temurin-17-alpine 容器 | javac + JUnit；校验完整报告与退出状态 |
| C / C++ | zxbench/cpp:gcc13-valgrind 容器 | 编译 + 断言；fixture 可启用 Valgrind，并非所有题默认检查内存 |
| Rust | rust:1.75-alpine 容器 | rustc + assert；编译与运行失败分开 |
| PHP | php:8.2-cli-alpine 容器 | 显式开启 zend.assertions/assert.exception |
| C# | .NET SDK 8.0-alpine 容器 | dotnet build + 自定义 Assert |
| Bash | bash:5 容器 | -e / pipefail、语法检查与完成证据 |
| SQL | node:22-alpine 容器 | node:sqlite 建表+插数+查询+结果集比对（性能题用 EXPLAIN 计划检查） |

除常规「修复 bug」题外，编程维度还包含：

- **no_bug 陷阱题**：代码正确，模型须输出 `NO_FIX_NEEDED` 并说明原因；强行修复得 0 分。
- **plan 题**：方案评审 / 故障诊断（数据库零停机迁移、p99 延迟排查等），按步骤 checklist 评分，已归入指令遵循维度。
- **实现题**：给定签名与类型约束补全实现（如 safeParseInt、Top-N 查询）。

2026-09-12 新增跨 12 种语言的真实容器正反例回归（`pnpm test:containers`）。这验证执行器，不代表现有每一道编程题都已通过独立金标双向复核；历史题的 referenceSolution/fixture 覆盖仍不完整。默认容器无网络、非 root、工作区只读；部分构建题允许工作区写入。容器根目录并非全部只读，完成标记也不是防恶意篡改的安全边界。

### 2026-09-12 执行与评审可靠性升级

`code_repair@4.14.0`、`instruction_checklist_v6`、`pr_executable_evidence@1.0.0` 与 `challenge_supplement@1.0.0` 对应题库1.30.0。编程v3.5至v4.14、两道PR证据题及5道挑战补充题均不接受Judge/Judge-only改写。TypeScript类型题只做严格静态检查而不执行候选代码；原生语言与Bash逐例运行版本化宿主断言，并为并发/健全性题增加压力、Miri或源码契约。该能力不泛化为任意依赖、生产规模负载或任意多文件仓库语义认证。

本项目采用轻量发布门槛：正式主分接收当前有效、内容哈希已冻结且可复现评分的公开题目；原有20道多文件工程题保留正式范围，其金标覆盖缺口单列披露。`review`/`tier`/gold元数据保留于审计报告。新增挑战题的区分度状态独立披露，该筛选不使用Judge，也不会自动改写历史成绩。

当前状态与可执行准入命令见[轻量发布与题目区分度门槛](docs/lightweight-release-gate.md)。

### 2026-09-13 · 题库 1.31.1：补齐挑战题并恢复原有长任务正式范围

- 补入14道此前只在实验题包中的覆盖题（数学8道、幻觉6道），以及6道已实测条件概率题；新增20道默认正式题，纯确定性评分，不调用Judge。
- `MC2-004-R1` 接入为可按题号运行的开发题，不进入默认成绩；原 `MC2-004` 不收录，避免与修订版重复。
- 14道覆盖题曾在筛查中全通过，不冒充高区分度题；6道概率题属于两个题族的变体，不是6个独立能力题族。原有34道基础数学题未替换。
- 保留原有600道题面、金标和哈希，不回写历史结果。新旧题集总分不能直接混排。详见[接入与验收说明](docs/challenge-extension-1.31.md)。

### 历史更新 · 题库 1.30.0

- 新增 `challenge_supplement@1.0.0` 的5道冻结挑战题：幻觉抵抗2题、数学推理3题；严格二值确定性判分，Judge权重为0，只影响新运行。
- 同题单次API对照已完成：DeepSeek-v4-flash 5/5，GLM-5.2（腾讯API）3/5。两者均无截断、超时或环境错误；结果仅代表这5道挑战题，不等同于全量模型总分。
- 原 `MC2-004` 因三模型均失败而未进入1.30.0；`MC2-004-R1` 已缩小无效搜索空间并增加余数分布证书，仍待三模型区分度试跑，详见 [MC2-004修订说明](docs/mc2-004-redesign.md)。
- 多文件工程题的首批正向金标覆盖 JavaScript、Python、Go；C#、Rust、SQL 缺口不影响当前正式成绩，只阻止这些多文件题从开发影子区晋级。
- 实时监控页已修复暗色主题下“已完成”维度卡片标题与背景对比度不足的问题。

---

## 快速开始

### 环境要求

- Node.js ≥ 22.13（pnpm 11 与内置 node:sqlite 需要）
- pnpm ≥ 11
- **Docker**（编程题容器执行必需）

新的隔离 JSON 通道只使用本地已缓存镜像，不隐式联网安装依赖；缺少镜像视为环境未就绪。手动准备 `node:20-alpine` 与 `python:3.12-alpine`。下列旧执行器可能自动预热镜像，不代表已经通过防作弊验收。

QuickJS和PR证据专项另要求[交付文档](docs/trusted-observation-v3.6.md)中指定的镜像digest及锁文件依赖；只有同名tag并不足够。缺失时显式报环境未就绪，不拉取替代镜像、不计模型失败。

**① 单文件修复题（code_repair / sandbox）**

```bash
docker pull golang:1.21 eclipse-temurin:17-jdk-alpine gcc:13 rust:1.75 php:8.2-cli mono:6.12 bash:5 node:22-alpine
```

**② 多文件工程修复题（project_repair，CP-L4）**

```bash
docker pull python:3.12-alpine node:20-alpine golang:1.22-alpine maven:3.9-eclipse-temurin-17-alpine rust:1-alpine gcc:13 mcr.microsoft.com/dotnet/sdk:8.0 php:8.2-cli-alpine bash:5 postgres:15
```

> 环境要点（Environment Notes）：
> - project_repair 容器以**非 root（UID 65534）**运行，grader 注入 `HOME=/tmp` 保证 dotnet / go / npm 的缓存目录可写（否则 `HOME=/nonexistent` 会 EACCES）。
> - Java 工程题使用预构建镜像 `zxbench/java-spring:3.2.5`（首次由场景脚本自建）；C/C++ 内存检查使用 `zxbench/cpp:gcc13-valgrind`。
> - 受限容器（非 root + cap-drop + no-new-privileges）下 **AddressSanitizer 不可用**（会 DEADLYSIGNAL），C/C++ 内存安全改由 Valgrind / 测试断言覆盖。
> - Java 单文件题的 JUnit jar 已内置在 data/java-libs/，随仓库分发，无需额外下载。
>
> The programming dimension has **two execution backends**:
> ① Single-file repair (code_repair / sandbox): first `docker pull` list above.
> ② Multi-file project repair (project_repair, CP-L4): second list above.
> project_repair containers run as **non-root (UID 65534)** and the grader injects `HOME=/tmp` so dotnet/go/npm caches stay writable. Java project scenarios use prebuilt `zxbench/java-spring:3.2.5`; C/C++ memory checks use `zxbench/cpp:gcc13-valgrind`. ASan is disabled under the restricted container (would DEADLYSIGNAL), replaced by Valgrind / asserts.

### 安装与启动

```bash
# 1. 安装依赖
pnpm install
pnpm --filter server prisma:generate

# 2. 配置环境变量
cp apps/server/.env.example apps/server/.env

# 3. 构建
pnpm build

# 4. 启动（Windows 一键脚本，带 watchdog 自动重启）
start.bat

# 或手动启动后端（默认端口 3001）
pnpm --filter server start
```

浏览器访问 http://127.0.0.1:3001。

### macOS 专属说明

本项目是标准 pnpm + Node/TypeScript + Docker monorepo，源码无平台专属依赖，**macOS（Intel 与 Apple Silicon 均支持）可直接运行**。注意以下几点：

- **用 pnpm 脚本启动，不要用 `start.bat` / `start-server.ps1`**：这两个是 Windows 便利脚本，macOS 上不可用。请用：
  ```bash
  pnpm install && pnpm build
  pnpm --filter server start        # 或 pnpm dev 一键起前后端
  ```
- **先装 Docker Desktop for Mac**：编程维度所有语言都跑在容器里，评测前请确认 Docker Desktop 已启动（否则编程维度会整体 `Docker unavailable` 跳过）。`node:20-alpine` / `python:3.12-alpine` / `bash:5-alpine` / `postgres:15` 等均为多架构镜像，Apple Silicon 上自动拉取 arm64 原生版本。
- **Node 版本**：用 nvm / fnm / Homebrew 装 Node ≥ 22.13、pnpm ≥ 11；若系统 Node 过旧，`pnpm install` 会因 `engines` 限制报错。
- **无需担心 Windows 的 node_modules 符号链接损坏**：macOS 原生支持 symlink，`pnpm install` 不会复现该问题，`pnpm test` 可正常跑（仓库已加 `pretest` 自动构建 TS 库，clone 后直接 `pnpm test` 即可）。

### 2026-09-08 推理题参考答案修订（issue #7）

34道基础数学题使用3.2.0 / exact_answer_v4；78道基础幻觉题使用5.0.0 / hallucination_v5。1.30.0新增3道数学、2道幻觉题，1.31.0接入遗漏题包，1.31.1恢复20道原有长任务的正式范围；当前定义为数学52道（默认51）、幻觉86道。基础数学检查最终答案和必要构造；基础幻觉简单事实离线核验，其余自然语言按逐题rubric调用Judge；新增挑战题纯确定性核验。Judge不可用的语义题标记为未能评分并排除汇总。旧版本成绩不与新题集混排。详见[基础题逐题验证](docs/reviewed-question-bank-v5.md)及[挑战题接入说明](docs/challenge-extension-1.31.md)。运行 `node scripts/sync-reviewed-question-contracts.mjs <数据库路径>` 预览；加 `--apply` 自动备份后事务同步，不改写历史结果。

### 2026-09-12 数据抽取题集 v3

数据抽取维度从 35 题扩充到 56 题。原 35 题已逐题对齐题面与金标，新增 21 题覆盖来源优先级、去重、时区、null/false/0、表连接、文档版本、邮件引用、脚注、OCR、多语言、嵌入式指令攻击等场景。`json_atomic_v3` 冻结完整 `expected`、所有路径的 JSON 类型、必需叶路径和禁止额外字段策略；纯规则评分，不调用 Judge。Markdown 围栏、类型强转、缺失 null、额外键和数组长度漂移都会被确定性扣分。所有 56 题均为 3.0.0、`reviewStatus=verified`，并由 canonical `scenarioHash` 锁定。详见[数据抽取 v3 复核与冻结记录](docs/data-extraction-v3-review.md)。

### 导入基准题集

```bash
node scripts/seed-benchmark.mjs   # 导入
node scripts/export-scenarios.mjs # 导出
```

导入只认当前版本的 `benchmark.json`。直接运行即可安全升级：历史版本误从 CR2/开发 JSON 导入、但已不属于正式题库的内置题目会被标记为退役；用户自行创建的题目与历史成绩不会被删除。正式评测始终按发布题库白名单及内容哈希冻结，数据库残留行不会扩大题量。

---

## 核心概念：综合分是怎么算出来的

### 10 大评测维度与题量

| 维度 | 中文名 | 题量 | 维度权重 |
|------|--------|------|----------|
| program | 编程能力 | 150 | 0.20 |
| hallucination_resistance | 幻觉抵抗 | 86 | 0.12 |
| reasoning_math | 推理与数学 | 52 | 0.12 |
| instruction_following | 指令遵循 | 42 | 0.12 |
| safety_authority | 安全与权限 | 50 | 0.10 |
| agent_workflow | 智能体工作流 | 45 | 0.08 |
| tool_cli_workflow | 工具/CLI/工作流 | 56 | 0.07 |
| data_extraction | 数据抽取 | 56 | 0.07 |
| cli_deep_tasks | 深度命令行任务 | 56 | 0.07 |
| structured_output | 结构化输出 | 28 | 0.05 |
| **合计** | | **621** | |

> 题量为当前定义数；默认仅排除 `MC2-004-R1`，正式默认编程150题、数学51题、幻觉86题，总计620题。该开发题可按题号专项运行。另有78道旧题归档于 `data/scenarios/archive/benchmark-retired.json`，累计699道。

### 三步评分链

1. **维度内难度加权均分**：每道题按难度加权（easy=1, medium=1.5, hard=2, adversarial=2.5），高难题影响更大但不过度放大。

```
维度均分 = Σ(题目得分 × 难度权重) / Σ(难度权重)
```

2. **维度加权总分（综合分）**：把各维度均分按「维度权重」加权求和。

```
综合分 = Σ(维度均分 × 维度权重) / Σ(维度权重)
```

3. **确定性评分与 AI Judge 双通道**：每个维度按题型定义 det/judge 权重。当确定性评分器有「未测量轴」（coverage < 1）时，其权重按覆盖率让渡给 AI Judge 补判；无 Judge 且覆盖率 < 0.5 时，总分打 3 折避免未验证给满分。

> 注意：打折只作用于总分，deterministicScore 始终保存「原始」确定性分，已有回归测试锁定。

### 难度分布说明

各维度的难度标签分布并不均匀：agent_workflow / cli_deep_tasks 有 84-86% 的题是 hard/adversarial，而 reasoning_math / structured_output 只有 32-36%。因此**跨维度的分数横向比较需谨慎**——同一分数在不同维度上的难度基线不同。

issue #7 修订前的推理维度历史分数需要重新核验，不应据此推断模型“数学弱、工作流强”等跨维度能力差异。


---

## 页面功能详解

### 1. 总览（Dashboard）
评测系统主页：全局统计、维度雷达图、维度分布表。

![总览](docs/screenshots/dashboard.png)

### 2. 创建评测（EvalCreate）
配置评测参数，支持单模型与多模型并行，提交后跳转实时监控。

![创建评测](docs/screenshots/eval-create.png)

### 3. 实时监控（EvalLive）
评测运行中的实时视图，支持暂停/恢复/取消、fork 分叉维度、单题重试。

### 4. 评测历史（EvalHistory）
所有评测记录（含已取消记录）列表，支持进入监控、恢复、详情、报告，以及删除单次或整组记录。展开分组可单独删除某次运行；删除前会列出确切运行并要求确认。删除会永久移除所选运行、回答、评分与运行内报告，不删除模型配置、题库或独立导出文件。运行中、等待中及后台评测/补评尚未退出的记录不可删除；整组删除失败时全部回滚。

![评测历史](docs/screenshots/eval-history.png)

### 5. 评测详情（EvalDetail）
单次评测的逐题明细、证据折叠、单题重试。

### 6. 评测报告（Report / ReportList）
总分、维度雷达、排名、分数分布、评分证据构成、AI 深度报告。

![评测报告列表](docs/screenshots/reports.png)
![单份评测报告](docs/screenshots/report.png)
![AI 报告](docs/screenshots/report-ai.png)

### 7. 排行榜（Leaderboard）
按模型聚合排名，支持「最新 run / 跨 run 最优」两种口径。

![排行榜](docs/screenshots/leaderboard.png)

### 8. 题目管理（Scenarios）
题库管理：查看/编辑/删除、从 Pack 导入（含 SSRF 与路径穿越防护）。

![题目管理](docs/screenshots/scenarios.png)

### 9. 模型对比（CompareModels）
多模型对比报告，逐维度分析差异。

![模型对比](docs/screenshots/compare.png)

### 10. 模型性价比（ModelValue）
综合分为 X 轴、输出 token 为 Y 轴的散点图。

![模型性价比](docs/screenshots/value.png)

### 11. 系统设置（ModelConfig）
模型配置中心：添加/编辑/删除被测模型与 AI Judge 模型。

![系统设置](docs/screenshots/settings.png)

---

## 创建评测 · 设置项说明

### 基础

| 设置项 | 类型 | 说明 |
|--------|------|------|
| 测试模式 | 单选 | 单模型 / 多模型并行 |
| 评测名称 | 文本 | 列表与历史中识别 |
| 被测模型 | 选择 | 推理模型自动分配更大 token 预算（默认 49152） |
| 评测维度 | 多选 | 不选 = 全部 10 维度 |
| Max Tokens | 数字 | 单次生成最大 token 数（默认 8192） |
| Temperature | 数字 | 生成随机性；推理模型强制 1 |
| 每题运行次数 | 数字 | 每题重复运行次数（默认 1） |

### 高级选项

| 设置项 | 类型 | 说明 |
|--------|------|------|
| AI Judge | 开关 | AI Judge 模型二次评分复核 |
| 争议升级 | 开关 | 规则分与 Judge 分分歧时升级复核 |
| 安全红线检查 | 开关 | 安全红线检测（默认开） |
| 隐藏测试 | 开关 | 用隐藏测试用例检验回答（默认开） |
| 结构化输出 | 开关 | structured_output 维度要求结构化输出 |
| AI Judge 模型 | 选择 | 评分复核模型 |
| 并发题目数 | 滑条 | 并发题数（1–4，默认 4） |
| 并行模式 | 单选 | 全局并发池 / 维度独立并行 |

> **幻觉题评分边界**
> 新版简单事实与选项采用完整答案离线验证；其余回答由 Judge 逐点评判。语义题缺少成功的 Judge 时保留回答并排除汇总。材料引用和校验位不等于外部文献真实性；对实际出现的外部引用仍提示人工复核。仅切换到“支持联网”的模型名称不会自动为当前 Chat Completions 调用增加检索工具。

### 思考约束（反拖尾）

应对推理模型（QwQ / DeepSeek-R1 等）无限思考导致超时。

| 设置项 | 类型 | 说明 |
|--------|------|------|
| 先答案后原因 | 开关 | 强制先给最终答案再给原因 |
| 思考链上限 (token) | 数字 | reasoning_content 最大 token（0 = 不限） |
| 单题硬时限 (秒) | 数字 | 单题最长等待（默认 300） |
| 超限处置 | 选择 | 判 0 分 / 降权 / 标记人工复核 |

---

## 系统设置 · 模型配置项说明

| 设置项 | 说明 |
|--------|------|
| 模型 ID | 真实 API 模型 ID |
| 模型名称 | 用户友好显示名（可选） |
| 模型类型 | 被测模型 / AI Judge |
| Provider | OpenAI Compatible / Ollama / Local |
| Base URL | API 地址（Ollama 默认 http://localhost:11434/v1） |
| API Key | 访问密钥；入库前加密存储 |
| 推理模型 | 自动分配更大 token 预算（默认 32768） |

---

## 技术架构

| 层 | 技术 |
|----|------|
| 前端 | React 18 · Vite 5 · Ant Design 5 · ECharts |
| 后端 | Fastify 5 · Prisma 5 · SQLite（WAL）· WebSocket |
| 引擎 | packages/core：模型调用、评分器、AI Judge、安全、沙箱、容器执行、隐藏测试、编排器、报告 |
| 工程 | pnpm monorepo（apps/web · apps/server · packages/*） |

### 目录结构

```
apps/web/        # React 前端
apps/server/     # Fastify 后端 + API + Prisma
packages/core/   # 评测引擎核心（orchestrator / judge / evaluators / scoring / execution / contracts）
packages/types/  # 共享类型
packages/utils/  # 工具函数
data/scenarios/  # 621 道当前定义（默认正式620道）；另含元数据、开发原型与退役归档
data/java-libs/  # Java 题 JUnit 依赖 jar
scripts/         # 题库导入/导出脚本
docs/            # 规范文档（fixture-spec 等）
```

---

## 评测可靠性与高区分度方法

本版本将评测结果视为一组可审计证据，而不是简单地从历史结果中“取最高分”：

- 暂停恢复、重试和 Judge-only 补评按题目尝试链归并；题级主结果采用最后完成的尝试，若该行是环境错误或评分缺失则隔离披露，不回退到旧高分。
- 报告与排行榜从运行时冻结题集和每题最后完成的结果行重算，不以历史最高分或旧摘要替代。可运行 `pnpm --filter server run:verify-score <run-id> [database-url]` 只读核验题集哈希、历史行数、题级主结果数、各维度分和总分；旧数据库需要修复缓存摘要时显式追加 `--repair-summary`，工具会先创建数据库备份。
- Judge 只承担无法由确定性规则验证的语义原子项；输出使用精简 JSON、完整性校验和有界重试，失败时不会静默写成模型能力分。
- 模型请求支持硬时限、取消传播和孤儿请求清理；已保存答案可在执行环境恢复后重放，避免模型重复生成。
- 正式数学基础题以最终答案核验为主，新概率题验证五个精确概率，构造题验证所要求的证书；尚未全面实现自由文本推导或证明义务评分。更广泛的分层方法仍属实验模块，不是正式能力覆盖承诺。
- 校准页面与审计接口保留评分来源、覆盖率、人工复核状态和可比性信息；跨模型对照默认不把格式失败等同于语义失败。

方法与实现说明见 [评测可靠性实现](docs/evaluation-reliability-implementation-2026-09-09.md)、[评测完整性修复](docs/evaluation-integrity-fixes-2026-09.md) 和 [幻觉抵抗与数学推理最终方法](docs/resistance-math-method-final-2026-09-12.md)。运行 `pnpm eval:methods-v2 -- --help` 查看冻结题包的导出、校验和评分命令；运行 `pnpm eval:inspect -- --help` 查看能力覆盖检查参数。两条命令均为离线工具，不调用模型、Judge 或生产数据库。

---

## 测试与 CI

评分、聚合、契约、执行隔离、Judge 完整性与校准均包含回归测试：

```bash
pnpm test   # vitest 运行 packages/**/*.test.ts
```

GitHub Actions 在 push / PR 时自动执行：pnpm install → prisma generate → pnpm test → pnpm build。

---

## 许可

MIT License · Copyright (c) 2026 ZhiXiu Contributors
