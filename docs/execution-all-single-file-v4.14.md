# 单文件编程题可信判分迁移（v4.14）

## 交付范围

- `code_repair` 共127题：20道 `no_bug` 文本陷阱题维持规则判分；其余107道需修复题全部绑定版本化验证协议。
- 本批迁移26题：6道TypeScript，4道C，3道C++，4道Rust，7道Bash，以及各1道JavaScript、Python。
- 题库版本为1.28.0，共冻结345个正式测试ID；迁移脚本报告 `pendingCodeRepair: 0`。

## 信任边界

- 返回值协议、SQL结果集与执行计划由宿主比较，候选输出无判分权。
- TypeScript运行时题在固定Node 22只读容器内执行；类型题在128MB、10秒硬限制的独立编译器进程中做strict正/负向检查，候选代码不执行。
- C/C++/Rust/Bash及最后两道JS/Python题逐例执行宿主断言；编译、超时、异常和退出状态由宿主汇总。Treiber题使用确定性MPSC压力测试并核对内存序/禁用锁契约；unsafe Rust题使用Miri。
- 所有正式协议排除Judge和Judge-only覆写。环境故障记为unmeasured，不制造模型零分。

## 验收

- 每题金标全部通过。
- 每题原始缺陷与独立mutant至少失败一个正式测试。
- 每题开发控制通过；开发控制不计入正式分数，也不追溯修改历史成绩。
- 题库、SQLite定义表和执行审计清单同步时，`ScenarioResult`与`EvalRun`的行数及逐行哈希必须保持不变。

## 非范围

- 20道多文件 `project_repair` 不属于本次单文件迁移。
- 2道原自由文本PR评审已在题库1.29.0迁移为确定性可执行证据题，不再依赖人工或Judge；20道`project_repair`仍是独立的多文件验证工作。
