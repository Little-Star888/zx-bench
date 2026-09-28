用户更正数据库事实：项目已从 PostgreSQL 迁移到 CockroachDB。先读取已知旧记忆键，消除冲突，再将新事实保存到 project/database。不得丢失无关记忆或留下重复、矛盾的旧条目。已知旧记忆键为 project/database，新键为 project/database；新值须规范保存为“本项目已迁移到 CockroachDB”。
