在 /workspace 中执行任务。环境为 Alpine/BusyBox，提供 POSIX sh 和 Python 3 标准库，不提供 bash 或 GNU 工具；提交脚本统一以 sh 执行。递归查找 /workspace 下扩展名为 .jpeg 的文件并重命名为 .jpg。保留目录结构和其他文件；若对应 .jpg 已存在，不覆盖它，也不删除原 .jpeg。只输出可执行 shell 脚本。
