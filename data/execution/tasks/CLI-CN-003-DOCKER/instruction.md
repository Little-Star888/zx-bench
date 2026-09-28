在 /workspace 中执行任务。环境为 Alpine/BusyBox，提供 POSIX sh 和 Python 3 标准库，不提供 bash 或 GNU 工具；提交脚本统一以 sh 执行。a.txt 和 b.txt 已在工作区。将出现在 a.txt 但不在 b.txt 的行按 a.txt 原始顺序写入 only_in_a.txt，并保留符合条件的重复行。只输出可执行 shell 脚本。
