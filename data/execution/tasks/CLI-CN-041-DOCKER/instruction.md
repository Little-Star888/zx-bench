工作区 /workspace，Linux sh 和 Python 3 标准库可用。使用 Alpine/BusyBox 工具，提交脚本统一以 POSIX sh 执行，未提供 bash 或 GNU 工具。names.txt 的排序结果已存在于 sorted.txt。先比较实际文件内容；若已正确排序，保持 sorted.txt 的内容与修改时间不变，不做重复写入。只输出可执行 shell 脚本。
