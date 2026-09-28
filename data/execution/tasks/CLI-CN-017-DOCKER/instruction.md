在 /workspace 中执行任务。环境为 Alpine/BusyBox，提供 POSIX sh 和 Python 3 标准库，不提供 bash 或 GNU 工具；提交脚本统一以 sh 执行。access.log 是 Apache 通用日志，状态码为第 9 个空格分隔字段。统计各状态码出现次数，按次数降序向标准输出写出「次数 状态码」。只输出可执行 shell 脚本。
