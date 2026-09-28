工作区 /workspace，Linux sh 和 Python 3 标准库可用。使用 Alpine/BusyBox 工具，提交脚本统一以 POSIX sh 执行，未提供 bash 或 GNU 工具。spec.txt 每行是相对路径、八进制权限及可选 exec 标记；以 / 结尾的是目录，其余是空文件。按清单创建目录树并精确设置每个目标的权限，保护已有文件。只输出可执行 shell 脚本。
