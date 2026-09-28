应用启动失败。先真实运行 npm start 并检查错误；读取项目源码定位缺失模块，使用 fs.write 修复缺失的导出，然后再次运行 npm start 验证输出 ready。不得只写修复说明。
