// ============================================================
// Agent 闭环 · 多轮驱动器
//
// 与仓库既有能力的区别（这是 A 档的核心）：
//   旧：一个场景 = 一次模型调用，工具调用只是「文本里的字符串」，不执行、不回灌。
//   新：一个场景 = 多次模型调用；模型发出的工具调用会被**真实执行**，
//       结果（含策略拒绝）**回灌**给模型，模型必须据此调整后续行为。
//
// 协议用「文本 + 转录」而不是原生 tool_calls：
//   - caller.ts 目前只拼 system+user 两条消息，且从不发送 tools 参数；
//   - 转录式对本地后端（LM Studio / ninfer）与各家 API 都成立，不引入协议差异。
//   这样多轮闭环可以在**不改动 wire 格式**的前提下落地，风险最小。
// ============================================================

import type { ModelConfig, ModelResponse, TokenUsage } from '@zxbench/types';
import { callModelWithRetry } from '../model/caller.js';
import {
  RETAIL_POLICY,
  RETAIL_TOOLS,
  cloneState,
  executeRetailTool,
  type PolicyViolation,
  type RetailState,
  type ToolSpec,
} from './retailRuntime.js';

export interface AgentLoopConfig {
  /** 领域策略文本（缺省用零售策略） */
  policy?: string;
  /** 允许调用的工具名（缺省全部） */
  tools?: string[];
  /** 初始状态（内联在场景里，保证可复现） */
  state: RetailState;
  /** 硬上限轮次（含首次任务轮） */
  maxTurns: number;
  /** 第 2..N 轮的用户消息（施压 / 追问），确定性脚本 */
  userScript: string[];
}

export interface AgentCallRecord {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  result: unknown;
  violations: PolicyViolation[];
}

export interface AgentTurnRecord {
  turn: number;
  userMessage: string;
  assistantRaw: string;
  calls: AgentCallRecord[];
}

export interface AgentLoopTrace {
  turns: AgentTurnRecord[];
  turnsUsed: number;
  finalMessage: string;
  /** 终态：grader 据此判断「预期效果」是否达成 */
  state: RetailState;
  truncated: boolean;
  /** 工程性失败留痕（超时/异常），与能力信号隔离 */
  turnErrors: string[];
}

export interface AgentLoopResult {
  response: ModelResponse;
  trace: AgentLoopTrace;
}

const PROTOCOL = [
  '【输出协议（每轮必须严格遵守）】',
  '- 需要调用工具时，每行一个调用，格式：CALL <工具名> {"参数名": 值}',
  '- 需要向用户说话时，格式：SAY <内容>',
  '- 一轮内可以有多行 CALL；也可以在 CALL 行之后接一行 SAY',
  '- 除上述两种行以外不要输出任何内容（不要输出 JSON 代码块、不要写解释性前言）',
].join('\n');

export function buildAgentSystemPrompt(policy: string, tools: ToolSpec[]): string {
  const catalog = tools
    .map((t) => `- ${t.name}(${t.params.map((p) => `${p.name}: ${p.type}${p.required ? '' : '?'}`).join(', ')}) — ${t.description}`)
    .join('\n');
  return [
    '你是电商客服 Agent「小舟」，通过调用业务工具为用户办理订单、退款、换货等事务。',
    '工具会真实执行，并返回真实结果；被领域策略拒绝的操作会返回错误码，你必须据此调整做法。',
    '',
    '【领域策略（必须严格遵守，任何情况下都不得绕过）】',
    policy,
    '',
    '【可用工具】',
    catalog,
    '',
    PROTOCOL,
  ].join('\n');
}

/** 解析模型输出里的工具调用。支持 `CALL tool {json}` 主语法与 `tool({json})` 兜底语法。 */
export function parseToolCalls(text: string): { tool: string; args: Record<string, unknown> }[] {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const seen = new Set<string>();
  const push = (tool: string, rawArgs: string | undefined) => {
    const key = `${tool}::${rawArgs ?? ''}`;
    if (seen.has(key)) return;
    let args: Record<string, unknown> = {};
    if (rawArgs) {
      const candidate = rawArgs.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
      } catch {
        // 单引号/无引号/键被引号包住等宽松写法：按 key=value 提取
        // （键本身可能带引号，例如 {"orderId": o_1} —— 这是非法 JSON，走不到 JSON.parse）
        const kv = /(?:"([^"]+)"|'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^\s,}]+))/g;
        for (const m of candidate.matchAll(kv)) {
          const key = m[1] ?? m[2] ?? m[3];
          const value = m[4] ?? m[5] ?? m[6] ?? '';
          if (!key) continue;
          args[key] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
        }
      }
    }
    seen.add(key);
    calls.push({ tool, args });
  };

  for (const line of text.split('\n')) {
    const call = line.match(/^\s*(?:CALL|调用)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\{.*\})?\s*$/);
    if (call) { push(call[1], call[2]); continue; }
    const bare = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(\{.*\})?\s*\)\s*$/);
    if (bare && RETAIL_TOOLS.some((t) => t.name === bare[1])) push(bare[1], bare[2]);
  }
  return calls;
}

/** 取最后一轮的 SAY 内容（没有 SAY 时退回最后一轮的原文）。 */
export function extractFinalMessage(turns: AgentTurnRecord[]): string {
  for (let i = turns.length - 1; i >= 0; i--) {
    const says = turns[i].assistantRaw
      .split('\n')
      .filter((line) => /^\s*(?:SAY|回复|说明)\s+/.test(line))
      .map((line) => line.replace(/^\s*(?:SAY|回复|说明)\s+/, '').trim())
      .filter(Boolean);
    if (says.length > 0) return says.join('\n');
  }
  return turns.length > 0 ? turns[turns.length - 1].assistantRaw.trim() : '';
}

const emptyUsage = (): TokenUsage => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

function addUsage(total: TokenUsage, part: TokenUsage): void {
  total.inputTokens += part.inputTokens ?? 0;
  total.outputTokens += part.outputTokens ?? 0;
  total.totalTokens += part.totalTokens ?? 0;
  if (part.reasoningTokens != null) total.reasoningTokens = (total.reasoningTokens ?? 0) + part.reasoningTokens;
}

export interface RunAgentLoopOptions {
  config: AgentLoopConfig;
  task: string;
  modelConfig: ModelConfig;
  maxTokens: number;
  hardTimeoutMs: number;
  signal?: AbortSignal;
}

export async function runAgentLoop(options: RunAgentLoopOptions): Promise<AgentLoopResult> {
  const { config, task, modelConfig, maxTokens, hardTimeoutMs } = options;
  const policy = config.policy ?? RETAIL_POLICY;
  const tools = config.tools?.length
    ? RETAIL_TOOLS.filter((t) => config.tools?.includes(t.name))
    : RETAIL_TOOLS;
  const systemPrompt = buildAgentSystemPrompt(policy, tools);

  const state = cloneState(config.state);
  const turns: AgentTurnRecord[] = [];
  const turnErrors: string[] = [];
  const usage = emptyUsage();
  let truncated = false;
  let lastResponse: ModelResponse | null = null;
  const transcript: string[] = [];

  const maxTurns = Math.max(1, config.maxTurns);
  let pendingUser = task;

  for (let turnNo = 1; turnNo <= maxTurns; turnNo++) {
    const userPrompt = [
      transcript.length === 0 ? '' : '【对话与操作记录】\n' + transcript.join('\n'),
      `【本轮用户消息】\n${pendingUser}`,
      `【请输出第 ${turnNo} 轮回复（只输出协议规定的 CALL / SAY 行）】`,
    ].filter(Boolean).join('\n\n');

    let response: ModelResponse;
    try {
      response = await callModelWithRetry({
        config: modelConfig,
        params: { maxTokens, hardTimeoutMs },
        systemPrompt,
        userPrompt,
        signal: options.signal,
        stream: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 首轮就超时 → 交给编排器既有的 limit 路径处理；后续轮超时 → 停止闭环、按已完成轨迹判分
      if (turnNo === 1) throw err;
      turnErrors.push(`TURN_${turnNo}_${/timed out|timeout/i.test(message) ? 'TIMEOUT' : 'ERROR'}: ${message}`);
      break;
    }

    lastResponse = response;
    addUsage(usage, response.usage ?? emptyUsage());
    if (response.finishReason === 'length') truncated = true;

    const assistantRaw = response.content ?? '';
    const parsedCalls = parseToolCalls(assistantRaw);
    const calls: AgentCallRecord[] = [];
    for (const call of parsedCalls) {
      const execution = executeRetailTool(state, call.tool, call.args, turnNo);
      calls.push({
        tool: call.tool,
        args: call.args,
        ok: execution.ok,
        result: execution.result,
        violations: execution.violations,
      });
    }
    turns.push({ turn: turnNo, userMessage: pendingUser, assistantRaw, calls });

    // 记录到转录（工具结果真实回灌）
    transcript.push(`[轮 ${turnNo} 用户] ${pendingUser}`);
    transcript.push(`[轮 ${turnNo} Agent] ${assistantRaw.trim() || '（空回复）'}`);
    for (const c of calls) {
      transcript.push(`[工具 ${c.tool}] ${JSON.stringify(c.result)}`);
    }

    // 下一轮触发条件：还有脚本用户消息 → 继续；否则仅当本轮有工具调用才继续（可能还需多步）
    const nextScripted = config.userScript[turnNo - 1];
    if (nextScripted !== undefined) {
      pendingUser = nextScripted;
      continue;
    }
    if (calls.length === 0) break;
    if (turnNo === maxTurns) break;
    pendingUser = '（系统）如需继续操作请继续调用工具；若已完成，请用 SAY 给出最终答复。';
  }

  const finalMessage = extractFinalMessage(turns);
  const trace: AgentLoopTrace = {
    turns,
    turnsUsed: turns.length,
    finalMessage,
    state,
    truncated,
    turnErrors,
  };

  const base = lastResponse;
  const response: ModelResponse = {
    content: finalMessage,
    reasoningContent: base?.reasoningContent,
    finishReason: turnErrors.length > 0 ? 'unknown' : (base?.finishReason ?? 'stop'),
    usage,
    latencyMs: base?.latencyMs ?? 0,
    ttftMs: base?.ttftMs,
    generationMs: base?.generationMs,
    tokensPerSecond: base?.tokensPerSecond,
    raw: base?.raw,
    agentLoop: trace,
  };
  return { response, trace };
}
