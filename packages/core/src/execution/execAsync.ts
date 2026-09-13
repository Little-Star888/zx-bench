import { spawn } from 'node:child_process';

export interface AsyncExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
}

export interface AsyncExecOptions {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  stdio?: 'pipe' | 'ignore';
  env?: NodeJS.ProcessEnv;
}

/** 异步版 spawnSync：不阻塞事件循环，返回与 spawnSync 一致的结果形状。 */
export function execAsync(command: string, args: string[], options: AsyncExecOptions = {}): Promise<AsyncExecResult> {
  return new Promise((resolve) => {
    const { cwd, timeout, maxBuffer = 8 * 1024 * 1024, stdio = 'pipe', env } = options;
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: stdio === 'ignore' ? 'ignore' : ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let outputLimited = false;
    let outputBytes = 0;
    let settled = false;

    const finish = (status: number | null, error?: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ status, stdout: Buffer.concat(stdoutChunks).toString('utf8'), stderr: Buffer.concat(stderrChunks).toString('utf8'), error });
    };

    const timer = timeout != null
      ? setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout)
      : null;

    if (stdio !== 'ignore') {
      child.stdout?.on('data', (d: Buffer) => {
        const remaining = Math.max(0, maxBuffer - outputBytes);
        outputBytes += d.length;
        if (remaining) stdoutChunks.push(Buffer.from(d.subarray(0, remaining)));
        if (outputBytes > maxBuffer) { outputLimited = true; child.kill('SIGKILL'); }
      });
      child.stderr?.on('data', (d: Buffer) => {
        const remaining = Math.max(0, maxBuffer - outputBytes);
        outputBytes += d.length;
        if (remaining) stderrChunks.push(Buffer.from(d.subarray(0, remaining)));
        if (outputBytes > maxBuffer) { outputLimited = true; child.kill('SIGKILL'); }
      });
    }

    child.on('error', (err) => finish(null, err as NodeJS.ErrnoException));
    child.on('close', (code) => {
      if (timedOut) {
        const e = new Error('ETIMEDOUT') as NodeJS.ErrnoException;
        e.code = 'ETIMEDOUT';
        finish(code, e);
      } else if (outputLimited) {
        const e = new Error('OUTPUT_LIMIT_EXCEEDED') as NodeJS.ErrnoException;
        e.code = 'ENOBUFS';
        finish(code, e);
      } else {
        finish(code);
      }
    });
  });
}
