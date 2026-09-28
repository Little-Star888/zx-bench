把现有部署技能中 Docker Hub 镜像地址精准改成 GHCR。先通过 skill_view 读取当前内容，再使用 skill_manage(action="patch") 原位替换；保留其他段落，不删除重建技能。
