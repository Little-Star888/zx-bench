# 结构化输出文本格式解析，正式题库 1.51.0–1.51.2

本次对 29 道文本格式题启用更深入的结构校验：YAML 5 道、TOML 2 道、XML/SVG 6 道、HTML 3 道、Mermaid 5 道、Markdown 4 道、SQL 4 道。解析与逐题规则分别在 `packages/core/src/parsers/textStructure.ts` 和 `packages/core/src/evaluators/structuredTextContracts.ts`。评分器通过 `requirements.text_contract = "v1"` 启用新规则；旧字段分与新结构分取较低值，避免新增通过项稀释原有失败。

## 实际检查

- YAML：缩进与映射/序列层级、重复键、文档分隔、锚点作用域，以及 Kubernetes、GitLab CI、Compose 配置的嵌套字段和计数。
- TOML：表与数组表、重复键、依赖数量和版本、workspace/package/bin/features/profile 层级。
- XML/SVG：元素嵌套、属性、裸实体、命名空间与子元素顺序；SOAP 版本、RSS 条目、XSD 元素、SVG 引用、报价单金额关系。
- HTML：元素树、语义标签、邮件模板内容、仪表盘卡片/柱形/表格数量。
- Mermaid：图类型、实体/类字段、关系和状态转移结构。
- Markdown：标题、表格、代码围栏、列表、引用块；API 文档的 JSON 示例会实际解析。
- SQL：忽略注释与字符串进行词法分析，核对窗口函数、建表定义、存储过程组件及 PostgreSQL 补货 CTE 结构。

SO-CN-032 原题要求在第二个 YAML 文档引用第一个文档的锚点，这不符合 YAML 文档作用域。题面现要求在第一文档内定义并引用，第二文档独立。SO-CN-036 的两个箭头示例原先误写成同一种，现明确为 `-->` 与 `<-->`。

## 离线验证

构建通过，7 个格式边界测试通过。对 6 个已完成模型运行中的 174 份历史答案做离线回放：原评分满分 135 份，新合同满分 115 份；20 份原满分答案暴露出新问题，未见任何答案因新增规则而涨分。修正后的 SO-CN-032 已另用有效双文档 YAML 样本验证。历史测评结果未改写，逐题回放见 `data/pilots/structured-text-contracts-audit.json`。发布前数据库与题库备份位于 `logs/structured-text-contracts-1790404733598`。

这些是针对本题库的有界结构解析。原始 1.51.0 发布时，SQL 尚未在目标数据库执行，Mermaid 未由渲染器验证，HTML/CSS 未做浏览器检查。满分比例降低说明判分覆盖提高，不能单凭此断言难度校准完成。

## 续查：1.51.1

使用本机已有的 PostgreSQL 15 镜像，在无网络、无宿主目录挂载的一次性容器中执行了两道 PostgreSQL 题的各 6 份历史答案。`SO-CN-013` 的夹具包含同一用户的多笔高额订单及月份边界：3/6 份原满分答案实际选出每城前三笔订单，而不是前三名不同用户。`SO-CN-034` 在有、无既存补货日志两种相同库存夹具下比较结果：3/6 份原满分答案把冲突更新后的累计日志量再次加到库存。两题新增经执行证实的保守文本规则后，历史答案离线回放各有 3 份由 100 降至 90，其余保持 100。正式题库仅这两题升级 `text_contract` 至 `v2`，题库版本为 1.51.1；旧 `v1` 规则仍可按历史场景快照复现。历史测评分数未改写。可复跑脚本和逐份结果分别在 `scripts/audit-structured-postgres.mjs`、`data/pilots/structured-postgres-audit.json`。

Chrome 离线检查了三道 HTML 题的 18 份历史页面。512 CSS px 视口下，`SO-CN-023` 的 2 份仪表盘发生文档横向溢出，而结构规则均给满分。该题未明确要求移动适配，因此这是视觉质量线索，不能据此扣分。结果位于 `data/pilots/structured-html-browser-audit.json`，脚本为 `scripts/audit-structured-html.mjs`。此检查未进入实时评分：浏览器逐题启动的成本较高，且当前命令行 Chrome 的最小视口约为 512 CSS px，不能代表更窄手机屏幕。

在 1.51.1 阶段，实时评分的可执行性轴仍标为未测量，因为 PostgreSQL 执行只用于离线审计，新规则是针对已确认错误模式的静态检查。Mermaid 和 MySQL 当时尚无本地目标运行组件。

## 剩余目标引擎验证：1.51.2

补齐本地目标组件后，使用 Mermaid 11.17.2 在本机 Chrome 中逐份解析并渲染五道题的 30 份历史答案：24 份成功，6 份失败。5 份失败已有输出纪律扣分；`SO-CN-024` 另有 1 份原满分 ER 图使用无类型的裸字段行，Mermaid 渲染器拒绝。新 `v2` 规则要求每个必需 ER 字段显式声明类型，该答案离线回放由 100 降至 89。脚本与结果见 `scripts/audit-structured-mermaid.mjs`、`data/pilots/structured-mermaid-render-audit.json`。

在无网络、无宿主目录挂载的一次性 MySQL 8.4.11 容器中执行 6 份建表及 6 份存储过程答案。建表题有 5/6 份成功创建全部五张表；唯一语法失败的答案原已扣分。存储过程题仅 1/6 份成功编译，并通过正常下单与库存不足回滚夹具；其中 2 份无法编译的答案原得满分。新 `v2` 规则检查 MySQL 游标声明顺序和已证实不适用的函数调用，两份原满分答案离线回放均降至 93。其他已扣分答案也可能进一步下降。脚本与结果见 `scripts/audit-structured-mysql.mjs`、`data/pilots/structured-mysql-audit.json`。

HTML 进一步在 Chrome CDP 中按 390px 手机视口与 1280px 桌面视口检查全部 18 份历史答案。唯一明确要求手机适配的 `SO-CN-019` 有 0/6 份横向溢出；`SO-CN-021` 有 1/6 份、`SO-CN-023` 有 3/6 份手机视口溢出，桌面均无溢出。后两题未要求手机适配，不据此扣分。脚本与结果见 `scripts/audit-structured-html-mobile.mjs`、`data/pilots/structured-html-mobile-audit.json`。

正式题库 1.51.2 仅将 `SO-CN-017` 和 `SO-CN-024` 升级至 `text_contract: v2`；旧题快照仍按 `v1` 规则复现，已完成测评分数不改写。目标引擎与浏览器验证已覆盖这些历史样本；实时评分仍不逐份启动数据库或浏览器，故可执行性轴继续如实标为未测量。当前规则仍是经执行证实的有界静态代理，不能等同于对所有未来答案的完整语义执行。

离线审计可重复执行：先准备本地镜像 `docker pull mysql:8.4.11`，以及忽略目录中的固定 Mermaid 包 `npm install --prefix logs/structured-mermaid-runtime mermaid@11.17.2 --no-save --ignore-scripts --package-lock=false`；然后分别运行上述三个审计脚本。PostgreSQL 审计使用已有的 `postgres:15-alpine` 镜像。审计不写入历史分数。
