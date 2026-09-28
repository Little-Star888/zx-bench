在 /workspace 中执行任务。环境为 Alpine/BusyBox，提供 POSIX sh 和 Python 3 标准库，不提供 bash 或 GNU 工具；提交脚本统一以 sh 执行。files/ 中有内容相同的文件。按 SHA-256 对内容分组，每组只保留修改时间最旧的一个，删除同组其余文件，内容唯一的文件不动。只输出可执行 shell 脚本。
