把部署技能中的 Docker Hub 镜像改为 GHCR。先读取技能，再通过原生 skill_manage(action=patch) 精确更新；不能直写或删除重建技能。
