# 结构化输出成对校准记录

日期：2026-09-26。状态：**发现可复现的转义保真难度；仅为开发证据，尚未发布新题。**

## 方法

同一来源、同一目标答案制作简单 JSON 与结构化 JSON 两版。只在简单版正确、结构化版失败时，记为结构化版额外失误。原始模型答卷、题包及金标均保存，不通过改写已试题面覆盖旧结果。每个候选先用有效参考答案和定向错误答案核对裁判。

## 已停止的路线

从 [T2S-Bench-MR](https://huggingface.co/datasets/T2SBench/T2S-Bench-MR)适配了 8 组成对开发题和 4 组按论文隔离的留出题，题包为 `data/pilots/structured-contract-frontier-v5/`。24 份参考答案与 3 份针对性错误答案通过本地裁判。Nerkyor 对 020（反事实推理）与 023（故障定位）的简单版和结构化版均全对，共 4 次调用。依据预设停止规则，未继续测其余 T2S 题；这批题仍是开发候选，不提供消除天花板的证据。

## SchemaBench Escape Translation

从 [SchemaBench 官方方法](https://github.com/thunlp/SchemaReinforcementLearning)适配真实 JSON Schema 和特殊字符串。官方测试用 `model_schema` 给题、`verify_schema` 判答；本地判分额外要求指定路径**必须存在且解码后的字符串完全一致**，避免可选字段被省略而蒙混过关。原始来源 825 行中只保留入选的 4 行及全文件 SHA-256；来源快照见 `data/pilots/schemabench-source/translation-selected.json`。原始 Schema 的来源许可证尚需逐项核对，因此这些题暂不发布到正式题库。

| 冻结版本和题 | 模型 | 简单 JSON | 真实 Schema JSON | 解释 |
|---|---|---:|---:|---|
| v1，61，开发 | Nerkyor | 失败 | 失败 | 两边 JSON 与 Schema 均通过，但指定值的控制字符丢失；属于转义保真难点，不能证明复杂 Schema 增量难度。 |
| v1，61，开发 | DeepSeek v4.1 Flash | 未测 | 通过 | 两家族在这一题有差异。 |
| v2，635，开发 | DeepSeek v4.1 Flash | 未测 | 失败 | 旧题面中的 `logoURI` 同名字段有歧义，模型同时填了顶层和数组内字段；这次失分**作废**。 |
| v3，635，开发 | DeepSeek v4.1 Flash | 通过 | 失败 | 明确指定顶层 `/logoURI` 后，Schema 通过，字符串控制字符被替换或省略。成对失误有效。 |
| v3，635，开发 | Nerkyor | 未测 | 失败 | 同题结构化版也丢失控制字符；尚无该模型的成对简单版结果。 |
| v3，95，来源隔离留出 | DeepSeek v4.1 Flash | 通过 | 失败 | 另一真实 Schema 上复现：Schema 通过，制表/换页字符被改写。 |

v3 的两组参考答案及对应错误答案均经裁判通过；两组来源 Schema 不同，开发题与留出题没有共享模板文件。两次 DeepSeek 成对成功差均为“简单版通过、真实 Schema 版失败”。这说明结构化输出在**转义保真与真实 Schema 组合**上存在可测区分度，但只有一个能力家族、两个样本，不能外推为新题库整体难度。两模型共 **13 次**新增生成：T2S 4 次，SchemaBench v1 3 次、v2 1 次、v3 5 次；无 Judge、无重试、无正式全量评测。

## Bonsai2 与 Qwen3.8 顺序复测（2026-09-26）

按同一 v3 冻结题包，先测 Bonsai-2-27B-PTQ1_0，再测 Nerkyor Qwen3.8-27B。每个模型各测开发 635 与留出 95 的简单版、结构化版，共 4 个判分结果。Bonsai2 用 Prism 专用引擎；Qwen3.8 用 Unsloth，开发 635 结构化版复用先前同模型、同配置、同题面答卷，所以本轮新增模型生成 7 次。两模型均禁用约束解码、Judge 与重试。

| 模型 | 开发 635 简单/结构化 | 留出 95 简单/结构化 | 判定 |
|---|---|---|---|
| Bonsai-2-27B-PTQ1_0 | 失败 / 失败 | 失败 / 失败 | 两组成对均为共同失败 |
| Nerkyor Qwen3.8-27B | 失败 / 失败 | 失败 / 失败 | 两组成对均为共同失败 |

8 个答案全部通过 JSON 语法和 Schema，全部未通过指定字符串逐字符一致性断言。主要错误是删去或改写控制字符；相同来源的简单版也失败。因此这两模型的结果证明当前候选题能测出**字符串保真**难度，但不支持“复杂 Schema 额外造成失误”的结论。先前 DeepSeek 的两组成对失误仍成立于该模型配置，但跨模型表现不稳定；此候选家族不应据此直接替换正式题。原始答卷与逐字符差异见 `data/pilots/structured-contract-escape-v3/calibration-*-ed16d154-f5e9-4650-b355-cf5418846b81-bonsai2-paired.json` 和 `calibration-*-05c8edd2-6ca6-4c95-9090-e6431b8ab415-qwen38-paired.json`。

## 扩大样本：T2S 成对开发集 8 组

由于两组真实 Schema 题不足以概括表现，继续用已经冻结的 `structured-contract-frontier-v5` 开发集，覆盖边界测试、故障定位、反事实推理三类。每组同源事实设简单版和结构化版，两个模型各得到 16 份答案。Bonsai2 本轮新生成 16 份；Qwen3.8 新生成 12 份，复用同配置保存的 020、023 两组 4 份答卷。沿用各模型既有生成配置，单次直接生成，无 Judge、无重试。

| 模型 | 两版均通过 | 两版均失败 | 简单版通过、结构化版失败 | 单份答案整题通过 |
|---|---:|---:|---:|---:|
| Bonsai-2-27B-PTQ1_0 | 5 组 | 3 组 | 0 组 | 10/16 |
| Nerkyor Qwen3.8-27B | 6 组 | 2 组 | 0 组 | 12/16 |

Bonsai2 的 020 两版和 038 基础版把生成额度耗在推理内容上，未产出可判分答案；038 结构化版通过 Schema、6 个目标值答对 3 个。087 两模型基础版就答错，结构化版也有内容错误。Qwen3.8 的 038、087 两版均为内容错误。失败不能归因于增加 Schema 的要求。加上上节两组真实 Schema 题，两个模型各覆盖 **10 组配对题、20 份答案**，仍未观察到结构化版特有失误。T2S 独立留出 4 组未运行：开发集没有产生可复核的结构化特异候选，按预设停止规则避免无效追加调用。开发答卷在 `data/pilots/structured-contract-frontier-v5/calibration-development-*-bonsai2-full-dev.json`、`calibration-development-*-qwen38-rest-dev.json` 及 Qwen3.8 旧的 `t2s020`、`t2s023` 答卷中。


## 可执行 Schema 的新增成对证据

另用行为判分制作两组规则到 JSON Schema 的开发探针，固定正反例并在模型调用前核对正确 Schema 与错误答案；题包为 `structured-contract-frontier-v7`。Bonsai2 在默认思考配置下，数组题基础版正确，但 Schema 版输出超过 1.4 万推理 token 后仍未返回，主动中断并记录为运行错误，不计能力失分。Prism 的 `--reasoning-budget 2048` 未有效限制输出；该尝试也中断，单独保存。此后启用 Prism 的 `--reasoning off --reasoning-budget 0`，并用 `runtimeTag` 区分配置。Qwen3.8 沿用原保存配置，v7 的数组与事件两组成对题均通过。

v7 事件题初版把 6 个有效样本连续放在前面，基础版存在顺序捷径。为消除这一疑点，冻结 `structured-contract-frontier-v8`：只把同一 20 个样本交错重排，有效编号变为 02、05、08、11、14、17；规则、正确 Schema 和行为判分不变。v8 的两份正确答案与两份定向错误答案通过本地准入。

| v8 事件规则交错对照 | 20 样本基础判断 | 生成 Schema 行为 | 结果 |
|---|---:|---:|---|
| Bonsai2 PTQ1_0，Prism 关闭思考 | 20/20 | 17/20 | 结构化特有失误 |
| Nerkyor Qwen3.8，原 Unsloth 配置 | 20/20 | 20/20 | 两版通过 |

Bonsai2 输出的是可编译的 2020-12 Schema，行为错误具体为：错误允许 debit 的 `payload.source`、允许 credit 缺少必需 `payload.source`、允许 normal transfer 带 `payload.approval`。这是条件分支与额外字段约束的真实错误，而非 JSON 解析、Schema 地址或控制字符逐字匹配问题。v7 事件题在同一 Bonsai2 关闭思考配置下也呈现基础版通过、Schema 版失败；将其错误 `$schema` 地址离线修正后仍只通过 10/20 个行为样本。v6 的数组及两组保留政策题基础版也失败，不能计为结构化特异复现；v6 的认证题两版均通过。故目前**证明了该配置下至少一个规则家族存在额外 Schema 生成难度，并在交错顺序下复现**，仍不能推断正式 60 题整体难度或低量化的单独因果作用。v8 答卷见 `data/pilots/structured-contract-frontier-v8/calibration-development-*-order-control.json` 与 `calibration-development-*-no-reason-order-control.json`。


## 发布边界与下一步

正式结构化输出仍是 **60 道**，本轮新增正式题 0、退役 0。已核对的旧题 8 配置全通过项中，剩余 7 道被明确保留为基础格式锚点；没有足够证据表明应拿锚点替换。新 14 道只抽查过部分题，不得冒称全部饱和。

下一个扩库动作先制作**第二种能力家族**（真实 Schema 的条件分支/跨字段一致性，避免字符保真重复题），使用同源简单版对照，并冻结独立留出。若两家族均有无歧义的开发与留出失误，再选择经保存答卷证实饱和、又不承担基础覆盖的正式题做一进一出替换。若找不到这样的旧题，应先增加挑战轨并单独报告其分数，不退役基础锚点。正式题数始终不低于 60。

**后续发布决定（1.57.0）：**按用户要求停止追加模型测试，直接将八配置历史全通过的 SO-CN-001 退役，并把 v8 事件条件 Schema 题以 `SOC4-G-EVENT` 加入正式题库。一进一出后正式结构化输出仍为 **60 道**，历史答卷保留。该题的价值是可执行 Schema 的条件字段与额外字段行为判分，已观察到 Bonsai2 的基础版正确而生成 Schema 漏掉 3 条约束，Qwen3.8 两版通过。此决定不宣称整个题库已消除天花板；发布详情与备份见 `analysis/structured-output-redesign/event-schema-replacement.json`。

**批量补充发布（1.58.0）：**针对仅替换一道不足以改善正式题库的问题，另退役八配置历史全通过的 SO-CN-038、SO-CN-043、SO-CN-055；将已有开发题 SOC2-C-D-1（Unicode 编码）和 SOC-D-D2（分层转义）晋升正式题，并加入 SOC4-G-BATCH（20 个正反例行为判分的数组约束 Schema）。连同 1.57.0，累计替换 **4 道**，正式结构化输出仍为 **60 道**。两道晋升题在既存两配置开发结果中出现差异；数组题有冻结的本地判分准入，但不宣称已有跨模型区分证据。发布未新增模型调用，详情与备份见 `analysis/structured-output-redesign/structured-batch-replacement.json`。

**第二批替换（1.59.0）：**继续退役 8 道历史近满分旧题（SO-CN-002、003、004、005、007、008、030、050），分别引入固定任务与金标的 A 路由、B 树结构、C 字符编码、D 转义、E 权限映射、F CSV、F YAML、G Schema 行为题。旧题在保存的八组配置里各通过 6–7 组；新题来自冻结的 v2 题包，已通过现有金标、定向错误答案和独立 Schema 准入。累计替换 **12 道**，正式结构化输出仍为 **60 道**；HTML、YAML 配置和 XSD 基础锚点仍保留。此次没有模型调用。v2 开发题在筛查配置中曾全部通过，因此这批替换改善的是任务约束与裁判明确性，**尚未证明总体得分天花板下降**。这些新题原属留出题，发布后不再用作独立留出证据。详情见 `analysis/structured-output-redesign/near-ceiling-batch-replacement.json`。
