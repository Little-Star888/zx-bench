// ============================================================
// 进程级执行日志兜底（R1，2026-09-16）
//
// 背景：`start-server.ps1` 会把 node 的 stdout/stderr 重定向到
// `logs/server-<时间戳>-{out,err}.log`，但一旦 watchdog 因连续启动失败退出，
// 评测往往改由「手动/非托管进程」执行——此时 stdout 无人接管，执行期日志全部丢失。
// 实测 09-15 run：`logs/` 下三个 server-*-out.log 均为 0 字节，全库检索 run id
// 只命中 tmp/ 临时文件，导致跑分异常无法归因（106 分钟空档至今无法解释）。
//
// 本模块在进程内把 console 输出镜像到 `logs/exec-YYYYMMDD.log`，
// 与启动方式解耦；日志目录按天滚动，便于长期留存与 run 归因。
// ============================================================

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/** 把任意 console 参数安全地转成单行文本（不抛异常、不产生多行污染） */
function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return Object.prototype.toString.call(value); }
  }
  return String(value);
}

let installed = false;
let logPath: string | null = null;

/** 当前执行日志文件路径（未安装则为 null），供 /api/health 之类的诊断端点披露 */
export function getExecutionLogPath(): string | null {
  return logPath;
}

/**
 * 安装进程级执行日志镜像。幂等：重复调用只生效一次。
 * @param logDir 日志目录（默认仓库根 `logs/`）
 */
export function installFileLogging(logDir?: string): void {
  if (installed) return;
  installed = true;

  try {
    const dir = logDir ?? path.resolve(process.cwd(), '..', '..', 'logs');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    logPath = path.join(dir, `exec-${stamp}.log`);
  } catch {
    // 日志不可写不应阻断服务启动
    logPath = null;
    return;
  }

  const target = logPath;
  const write = (level: string, args: unknown[]) => {
    try {
      const line = `[${new Date().toISOString()}] [${level}] ${args.map(stringify).join(' ')}\n`;
      appendFileSync(target, line);
    } catch { /* 日志失败不影响主流程 */ }
  };

  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = (...args: unknown[]) => { write('INFO', args); original.log(...args); };
  console.info = (...args: unknown[]) => { write('INFO', args); original.info(...args); };
  console.warn = (...args: unknown[]) => { write('WARN', args); original.warn(...args); };
  console.error = (...args: unknown[]) => { write('ERROR', args); original.error(...args); };

  process.on('uncaughtException', (err) => write('FATAL', [`uncaughtException: ${stringify(err)}`, err?.stack ?? '']));
  process.on('unhandledRejection', (reason) => write('FATAL', [`unhandledRejection: ${stringify(reason)}`]));

  // ============================================================
  // 崩溃/卡死归因插桩（2026-09-16）
  //
  // 现象：watchdog 记录「服务器进程意外退出 (ExitCode: )」，但 Windows 应用日志里
  // 没有对应的 Application Error / WER 事件，exec 日志也停在最后一条正常输出，
  // 没有任何 FATAL。要区分三种可能——干净退出 / 被 TerminateProcess 强杀 / 原生崩溃
  // ——唯一的办法是在进程内留下痕迹：
  //   · exit 处理器**执行了** ⇒ 走的是 JS 退出路径，退出码可读（例如 process.exit 或事件循环耗尽）
  //   · beforeExit 执行了 ⇒ 事件循环自然耗尽，多半是 server handle 被关掉了
  //   · 两个都没执行、但进程消失 ⇒ 被强杀或原生崩溃（JS 层拿不到任何机会）
  // 心跳则用于区分「事件循环被同步工作阻塞」与「只是响应慢」：
  // 心跳出现空档说明主循环被占住，这对 /api/health 探活超时是关键证据。
  // ============================================================
  const rss = () => { try { return Math.round(process.memoryUsage().rss / 1048576); } catch { return -1; } };
  const resources = () => {
    try {
      const info = (process as unknown as { getActiveResourcesInfo?: () => string[] }).getActiveResourcesInfo?.() ?? [];
      const counts = new Map<string, number>();
      for (const kind of info) counts.set(kind, (counts.get(kind) ?? 0) + 1);
      return [...counts.entries()].map(([k, n]) => `${k}:${n}`).join(',');
    } catch { return 'unavailable'; }
  };

  process.on('exit', (code) => {
    write('EXIT', [`exit code=${code} uptime=${Math.round(process.uptime())}s rss=${rss()}MB pid=${process.pid}`]);
    // 非零退出码写一份完整诊断报告（线程栈、libuv 句柄、堆统计），
    // 用于回答「是谁让进程退出的」。强杀/原生崩溃时本处理器不会执行，因此无副作用。
    if (code !== 0) {
      try {
        const reportPath = path.join(path.dirname(target), `report-${Date.now()}.json`);
        (process as unknown as { report: { writeReport: (p: string) => string } }).report.writeReport(reportPath);
        write('EXIT', [`diagnostic report -> ${reportPath}`]);
      } catch { /* 报告不可写不影响退出 */ }
    }
  });
  process.on('beforeExit', (code) => {
    write('BEFORE_EXIT', [`event loop drained, code=${code} rss=${rss()}MB — server handle 可能已被关闭`]);
  });
  process.on('warning', (warning) => {
    write('WARN', [`process warning: ${warning.name}: ${warning.message}`]);
  });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGBREAK', 'SIGHUP'] as const) {
    try {
      process.on(signal, () => write('SIGNAL', [`received ${signal} rss=${rss()}MB`]));
    } catch { /* 平台不支持该信号 */ }
  }

  // 心跳：默认 10 秒。用 unref 保证它本身不会阻止进程退出。
  // 心跳间隔可通过 EXEC_HEARTBEAT_MS 覆盖；设为 0 可关闭。
  const heartbeatMs = Number(process.env.EXEC_HEARTBEAT_MS ?? 10000);
  if (Number.isFinite(heartbeatMs) && heartbeatMs > 0) {
    const timer = setInterval(() => {
      write('HEARTBEAT', [`rss=${rss()}MB heap=${Math.round(process.memoryUsage().heapUsed / 1048576)}MB uptime=${Math.round(process.uptime())}s resources=${resources()}`]);
    }, heartbeatMs);
    timer.unref?.();
  }

  write('BOOT', [`server pid=${process.pid} node=${process.version} cwd=${process.cwd()} log=${target}`]);
}
