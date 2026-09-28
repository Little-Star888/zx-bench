import type { EvalConstraints, ModelConfig, ModelParams, ModelResponse, TokenUsage } from '@zxbench/types';
import { callModelWithRetry } from '../model/caller.js';
import { DockerSession, type SessionFile } from './sessionRunner.js';

export interface ShellConfig {
  files: SessionFile[];
  answer: string | number;
  maxTurns: number;
  image?: string;
  expectedImageId?: string;
  minCommands?: number;
  maxCommandsPerTurn?: number;
  /** Trusted fixture construction, completed before the model sees the workspace. */
  setupCommands?: string[];
}

export interface ShellEvent {
  turn: number;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  outputLimitExceeded: boolean;
}

export interface ShellTrace {
  imageId?: string;
  turns: Array<{ turn: number; assistantRaw: string; events: ShellEvent[];
    finishReason?: ModelResponse['finishReason']; usage?: TokenUsage }>;
  events: ShellEvent[];
  answer: string;
  errors: string[];
  elapsedMs: number;
  terminationReason?: 'completed' | 'no_action' | 'protocol_error' | 'model_error' | 'timeout' | 'turn_limit' | 'truncated';
  hardTimeoutMs?: number;
}

export async function runShellLoop(options: { config: ShellConfig; task: string; modelConfig: ModelConfig;
  modelParams?: ModelParams; constraints?: EvalConstraints;
  maxTokens: number; hardTimeoutMs: number; signal?: AbortSignal }): Promise<ModelResponse> {
  const { config } = options;
  const maxCommandsPerTurn = Math.max(1, Math.min(config.maxCommandsPerTurn ?? 4, 8));
  const session = await DockerSession.create({ image: config.image ?? 'python:3.12-alpine',
    expectedImageId: config.expectedImageId,
    files: config.files, timeoutMs: options.hardTimeoutMs, maxOutputBytes: 262_144 });
  try {
    for (const command of config.setupCommands ?? []) {
      const result = await session.exec(command);
      if (result.exitCode !== 0 || result.timedOut || result.outputLimitExceeded) {
        throw new Error(`Shell fixture setup failed: ${result.stderr.slice(0, 500)}`);
      }
    }
  } catch (error) { await session.close(); throw error; }
  const started = Date.now();
  const turns: ShellTrace['turns'] = [];
  const events: ShellEvent[] = [];
  const errors: string[] = [];
  const transcript: string[] = [];
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let answer = '';
  let terminationReason: NonNullable<ShellTrace['terminationReason']> = 'turn_limit';
  let lastResponse: ModelResponse | undefined;
  try {
    for (let turn = 1; turn <= Math.max(1, Math.min(config.maxTurns, 10)); turn++) {
      const remaining = options.hardTimeoutMs - (Date.now() - started);
      if (remaining <= 0) { errors.push('SHELL_TOTAL_TIMEOUT'); terminationReason = 'timeout'; break; }
      let response: ModelResponse;
      try { response = await callModelWithRetry({ config: options.modelConfig,
        params: { ...(options.modelParams ?? options.modelConfig.defaultParams),
          maxTokens: options.maxTokens, hardTimeoutMs: remaining },
        constraints: options.constraints,
        systemPrompt: [
          '你在隔离的 Linux 工作区调查用户的问题。需要查看环境时，每行输出 SHELL <命令>。',
          `每轮最多 ${maxCommandsPerTurn} 条命令。命令会真实执行，下一轮会收到原始 stdout、stderr 和退出码。`,
          '调查完成后单独输出一行 ANSWER: <答案>。不要声称没有执行过的检查已经完成。',
        ].join('\n'),
        userPrompt: [options.task, ...transcript].join('\n\n'), signal: options.signal, stream: true });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        const timedOut = /timeout|timed out/i.test(String(error));
        if (turn === 1 && !timedOut) throw error;
        errors.push(`TURN_${turn}_MODEL_ERROR: ${String(error)}`);
        terminationReason = timedOut ? 'timeout' : 'model_error';
        break;
      }
      lastResponse = response;
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;
      usage.totalTokens += response.usage.totalTokens;
      const raw = response.content ?? '';
      if (response.finishReason === 'length') {
        turns.push({ turn, assistantRaw: raw, events: [], finishReason: response.finishReason, usage: response.usage });
        errors.push(`TURN_${turn}_OUTPUT_TRUNCATED`); terminationReason = 'truncated'; break;
      }
      const commands = raw.split('\n').filter((line) => /^SHELL\s+/.test(line))
        .map((line) => line.replace(/^SHELL\s+/, '').trim()).filter(Boolean);
      if (commands.length > maxCommandsPerTurn) {
        turns.push({ turn, assistantRaw: raw, events: [], finishReason: response.finishReason, usage: response.usage });
        errors.push(`TURN_${turn}_TOO_MANY_COMMANDS`);
        terminationReason = 'protocol_error';
        break;
      }
      const turnEvents: ShellEvent[] = [];
      for (const command of commands) {
        const result = await session.exec(command);
        const event: ShellEvent = { turn, command, stdout: result.stdout, stderr: result.stderr,
          exitCode: result.exitCode, timedOut: result.timedOut,
          outputLimitExceeded: result.outputLimitExceeded };
        events.push(event);
        turnEvents.push(event);
        transcript.push(`[第 ${turn} 轮命令] ${command}\n[退出码] ${result.exitCode}\n[stdout]\n${result.stdout}\n[stderr]\n${result.stderr}`);
        if (result.timedOut || result.outputLimitExceeded) { errors.push(`TURN_${turn}_EXECUTION_LIMIT`); break; }
      }
      turns.push({ turn, assistantRaw: raw, events: turnEvents, finishReason: response.finishReason, usage: response.usage });
      answer = raw.split('\n').find((line) => /^ANSWER:\s*/.test(line))?.replace(/^ANSWER:\s*/, '').trim() ?? '';
      if (errors.length) { terminationReason = 'protocol_error'; break; }
      if (answer) { terminationReason = 'completed'; break; }
      if (commands.length === 0) { terminationReason = 'no_action'; break; }
    }
    if (terminationReason === 'turn_limit') errors.push('SHELL_TURN_LIMIT');
    const trace: ShellTrace = { imageId: session.imageId, turns, events, answer, errors, elapsedMs: Date.now() - started,
      terminationReason, hardTimeoutMs: options.hardTimeoutMs };
    return { content: answer, finishReason: lastResponse?.finishReason === 'length' ? 'length' : errors.length ? 'unknown' : 'stop', usage,
      latencyMs: trace.elapsedMs, shellLoop: trace };
  } finally { await session.close(); }
}
