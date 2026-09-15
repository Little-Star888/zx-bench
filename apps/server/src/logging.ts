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

  write('BOOT', [`server pid=${process.pid} node=${process.version} cwd=${process.cwd()} log=${target}`]);
}
