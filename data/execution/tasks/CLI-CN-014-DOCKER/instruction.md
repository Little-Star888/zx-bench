在 /workspace 中执行任务。环境为 Alpine/BusyBox，提供 POSIX sh 和 Python 3 标准库，不提供 bash 或 GNU 工具；提交脚本统一以 sh 执行。logs/ 下有若干 .log 文件。提取以 ERROR 开头的行写入 errors.txt；每行格式为「文件名:原始行」，按文件名排序，同一文件内保持原始顺序。只输出可执行 shell 脚本。
