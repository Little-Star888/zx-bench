# 三维能力结构变化候选实验 · 2026-09-14

本轮把《LLM数学推理评测综述-2026.md》中的结构变化、可验证答案、实例更新和预算披露转成可运行的候选实验。**实现完成不等于难度整改成功，是否保留必须看实际回答。** 本文只借用该综述的设计方向，不将其中榜单数字用作本地难度标定。

## 具体改变

| 题族 | 单实例题数 | 变化及验证 | 覆盖范围与限制 |
|---|---:|---|---|
| sampling_measure | 2 | 同一停止抽样过程，分别先选实验再选记录、合并记录后选记录；精确枚举，验证四个条件概率/期望 | 测抽样测度变化；不等于研究级数学 |
| latent_identification | 3 | 同样的来源、报告网格、字段，分别产生唯一确定、仅能求界、观测矛盾；验证精确端点和任意有效端点见证 | 两个观测量各自真实可达，组合未必可达；小规模有限网格仍可枚举 |
| optimization_status | 3 | 所有状态都是 4 变量、8 约束，混合符号及行列置换；验证原始/对偶、Farkas 或无界方向证书 | 消除约束行数泄露状态；不同构造的系数分布仍可能暴露线索，尚非分布匹配生成器 |
| transactional_reconstruction | 3 | 同名实体、时段内别名绑定、事务撤销、截止时间、重复事件、显式 null、删除后的 patch；含只改一个裁定的反事实及重排控制 | 通用 schema 不给正确记录数和逐字段 null；当前输入主要是结构化日志，尚不能代表复杂自然文档提取 |
| scoped_evidence_revision | 4 | 正式修订/草稿、身份登记变化、版本/人群/指标/时期边界、冲突、证据不足；含材料重排控制 | 测封闭材料中的证据约束；不能据此声称解决开放知识幻觉 |

开发包为 15 题、每族 1 个独立实例。另冻结 30 题 confirmation 包，每族 2 个新实例；共享生成题族，不称为未知题族泛化或免污染。两包答案、公开题面、代码摘要、题目摘要均被冻结。调用模型只发送公开的单题消息，不发送参考答案、题族状态或配对标签，每题独立上下文。

程序入口：

- `packages/core/src/evaluationLab/structuralChallenge/`：生成器、确定性判分及筛查。
- `packages/core/src/scripts/structural-challenge.ts`：导出、核验、评分、准备及运行已有 API 模型。
- `packages/core/src/scripts/screen-structural.ts`：从原始提交重新判分，输出题族筛查。
- `packages/core/src/scripts/run-structural-local.ts`：对本机已加载的 `qwen3.8-27b-nvfp4` 进行固定预算对照，不切换模型；发现正式评测运行时停止发出后续请求。

## 分数的含义

内容分和格式合规分开。唯一 JSON 答案可以直接提交或放在代码块中，代码块外的附加说明不参与证书有效性判断，也不冒充已核验的自然语言证明；多份答案、重复键和不可解析回答不做自动修复。

- 抽样：四个所求数值逐项精确判等。
- 可识别性和优化：完整答案/有效证书判定，允许不同的正确见证。
- 提取：实体与字段内容的 micro-F1。没有格式、字段存在、类型正确带来的固定保底分；顺序不计错，缺项和多项都影响内容分。实体 ID 本身是一个内容原子，只有 ID 正确、其余三个字段全错时得 25 分。
- 幻觉抵抗：逐条结论判分，每条必须状态和有效证据集合同时正确。不以六条结论“全对才得分”人为制造低分。
- 各题族先求均值，数学维度再按三个题族等权。配对题全对率仅作诊断，不充当总分。三个维度不合并一个新总分。

超时/截断表示在预算内未交付，交付指标计零，但不认定为已验证的内容错误；不可解析回答也单列。缺题或环境错误令相应题族分数为空，不能仅在成功解析样本上归一化成高分。筛查只用整族均完成且可判内容的模型来判断内容区分，格式差异和超时不得充当内容分差。

## 可复现实验

仓库根目录执行（已有目录不可覆盖，每次用新目录）：

```powershell
pnpm eval:structural export reports/my-structural/dev development 20260914 4
pnpm eval:structural verify reports/my-structural/dev
pnpm eval:structural prepare-run reports/my-structural/dev reports/my-structural/flash deepseek-v4-flash 32768 300
pnpm eval:structural run reports/my-structural/flash
pnpm eval:structural:screen reports/my-structural/dev reports/my-structural/screen.json reports/my-structural/flash/submission.json
```

其他模型也可只接收 `candidate-questions.json`，填写 `submission-template.json` 后离线评分：

```powershell
pnpm eval:structural grade reports/my-structural/dev path/to/submission.json reports/my-structural/offline-score.json
```

每份提交须包含 runId、modelId、modelFamily、contractHash；每个回答包含 id、questionHash、outcome、output。`outcome` 为 completed/timeout/truncated/environment_error。不能把同一基础模型的不同量化或重复运行算作独立模型族。

API 路径复用原有 DeepSeek/GLM 配置，只读数据库。保存请求、流、原始回答、服务端返回模型名、用量、时延、逐题判分和完整提交。无自动重试、无择优、无 Judge。模型目录内创建 `STOP` 可停止后续题目；一经启动的目录不重跑。

## 保留标准

本轮筛查只作描述，所有结果 `productionEligible=false`、`difficultyCalibrated=false`。在已完整测量的模型上仍达 95 分以上的题族，会被明确标为观察到天花板，不能因为实现形式较新就直接加入正式题库。

出现内容分差后，至少还需三种独立基础模型、每族四个独立实例、新实例确认和逐条错误审阅。这个样本数只是筛查下限，不是统计精度保证。变体按实例成组，不能把同一题的多种改写当作大量独立样本；当前不报告虚假的精细置信区间。

若题族仍饱和，下一轮应改变所需推理，而不是继续堆同模板题数：提取重点考察自然文档中的实体/关系恢复与跨文档冲突，幻觉抵抗重点考察证据是否足以推出结论、量词和条件边界，数学则保留确有内容错误且正确证书独立可验的构造。每次修改用新版本、新实例复测，开发包结果不能冒充确认集结果。

## 本轮结果与验证

首轮使用 32768 输出 token 上限、每题 300 秒、每模型串行 15 题。沿用各提供商已有 thinking 参数，因此不能解释为相同计算量；也不能与此前 90000 token/1200 秒实验直接作能力排名。两家试跑可以同时运行，合计最多两个在途请求。

DeepSeek 首轮 15/15 全部正确，三个维度均 100；GLM 首次请求 HTTP 429 后停止，各维度留空。Qwen 对照及最终题族判断见 [本轮结果](structural-challenge-2026-09-14-results.md)。所有实验文件位于 `reports/structural-challenge-2026-09-14-v1/`（本机 reports 为运行产物目录的 junction）。正式题库及历史成绩不受影响。

新增测试覆盖手算概率、可识别端点、替代有效证书、事务回放、引用失效、反事实/重排、缺题与超时、重复键、冻结摘要和筛查防误判。初次全量测试三处既有 PR 测试因 Docker 冷启动超出 5 秒失败；Docker 就绪后全量复测 **1511 通过、213 跳过、0 失败**（135 个测试文件通过）。新增模块测试共 12 项通过，core 构建与类型检查通过。
