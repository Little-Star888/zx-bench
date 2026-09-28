在 /workspace 中执行任务。环境为 Alpine/BusyBox，提供 POSIX sh 和 Python 3 标准库，不提供 bash 或 GNU 工具；提交脚本统一以 sh 执行。输出 syslog.txt 中所有包含独立单词 error 的行（区分大小写），保留原始行顺序。只输出可执行 shell 脚本。
