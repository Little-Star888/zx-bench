启动本地开发服务器：用 terminal 的后台模式执行 python3 -m http.server 8102 --bind 127.0.0.1 --directory site，再通过 process.list 和 http.get http://127.0.0.1:8102/health 确认就绪。完成时保持恰好一个服务器进程运行；不要在前台阻塞或重复启动。
