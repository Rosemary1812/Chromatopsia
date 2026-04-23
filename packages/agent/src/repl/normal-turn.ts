import type {
  LLMProvider,
  LLMResponse,
  Message,
  RuntimeAgentRole,
  RuntimeSink,
  Session,
  ToolCall,
  ToolContext,
  ToolResult,
} from '../foundation/types.js';
import { build_llm_context } from '../session/context.js';
import { needs_compression, DEFAULT_COMPRESSION_CONFIG } from '../session/summarizer.js';
import { registry } from '../foundation/tools/registry.js';
import { execute_tool_calls_parallel } from './executor.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { ApprovalHook } from '../hooks/approval.js';
import { retryStreamWithBackoff } from '../foundation/llm/retry-handler.js';
import { handleTruncation } from '../foundation/llm/continuation.js';
import { shouldCompact, getContextDiagnostics } from '../foundation/llm/token-counter.js';
import { createRuntimeEvent } from './runtime.js';
import type { RuntimeEventInput } from './runtime.js';
import { createApprovalRequestHandler } from './approval-bridge.js';

export interface HandleNormalTurnOptions {
  taskType: string;
  session: Session;
  provider: LLMProvider;
  skillRegistry: SkillRegistry;
  approvalHook: ApprovalHook;
  toolContext: ToolContext;
  isDebug: boolean;
  runtime: RuntimeSink;
  turnId: string;
  runtimeMetadata: { agentId: string; agentRole?: RuntimeAgentRole };
  extraSystemMessages?: Message[];
}

export interface NormalTurnExecutionSummary {
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
}

interface NormalTurnLoopState {
  noProgressRounds: number;
  lastToolSignature: string;
  lastToolOutputSignature: string;
}

interface AggregatedTokenUsage {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
}

function mergeTokenUsage(
  current: AggregatedTokenUsage,
  next?: {
    input?: number;
    output?: number;
    cache_creation?: number;
    cache_read?: number;
  },
): AggregatedTokenUsage {
  if (!next) return current;
  return {
    input: current.input + (next.input ?? 0),
    output: current.output + (next.output ?? 0),
    cache_creation: current.cache_creation + (next.cache_creation ?? 0),
    cache_read: current.cache_read + (next.cache_read ?? 0),
  };
}

class StreamTimeoutError extends Error {
  constructor() {
    super('Stream timeout (60s) — server did not respond');
    this.name = 'StreamTimeoutError';
  }
}

function formatLlmErrorMessage(err: unknown): { logMessage: string; userMessage: string } {
  const message = err instanceof Error ? err.message : String(err);
  const logMessage = err instanceof StreamTimeoutError
    ? `LLM Timeout: ${message}`
    : `LLM Error: ${message}`;
  return {
    logMessage,
    userMessage: `Error: ${message}`,
  };
}

function prepareTurnContext(
  session: Session,
  taskType: string,
  skillRegistry: SkillRegistry,
  extraSystemMessages: Message[],
) {
  return build_llm_context(session, taskType, null, skillRegistry, extraSystemMessages);
}

async function streamAssistantResponse(
  params: {
    provider: LLMProvider;
    ctx: ReturnType<typeof build_llm_context>;
    isDebug: boolean;
    emitRuntime: (event: RuntimeEventInput) => void;
    turnId: string;
  },
): Promise<LLMResponse | null> {
  const {
    provider,
    ctx,
    isDebug,
    emitRuntime,
    turnId,
  } = params;
  const STREAM_TIMEOUT_MS = 60_000;
  let llmResponse: LLMResponse | null = null;

  if (isDebug) {
    emitRuntime({ type: 'debug', message: `ctx.messages count: ${ctx.messages.length}` });
    for (const m of ctx.messages) {
      emitRuntime({ type: 'debug', message: `msg role=${m.role} content_len=${m.content.length}` });
    }
    emitRuntime({ type: 'debug', message: 'calling chat_stream with retry support...' });
  }

  const retryableGen = retryStreamWithBackoff(
    () => provider.chat_stream(ctx.messages, registry.get_all()),
    { maxRetries: 3, initialDelayMs: 1000 },
  );

  let result: IteratorResult<string, LLMResponse>;
  while (true) {
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
      timeoutId = setTimeout(() => {
        emitRuntime({ type: 'debug', message: 'Stream timeout after 60s, forcing close...' });
        resolve({ timedOut: true });
      }, STREAM_TIMEOUT_MS);
    });
    const nextPromise = retryableGen.next();

    const raceResult = await Promise.race([nextPromise, timeoutPromise]);
    clearTimeout(timeoutId!);

    if ('timedOut' in raceResult) {
      throw new StreamTimeoutError();
    }

    result = raceResult;
    if (result.done) {
      llmResponse = result.value;
      break;
    }

    const chunk = result.value;
    ctx.appendAssistantChunk(chunk);
    emitRuntime({ type: 'assistant_chunk', turnId, chunk });
  }

  emitRuntime({ type: 'assistant_chunk', turnId, chunk: '\n' });
  return llmResponse;
}

async function finalizeAssistantResponse(
  params: {
    provider: LLMProvider;
    ctx: ReturnType<typeof build_llm_context>;
    llmResponse: LLMResponse;
    isDebug: boolean;
    emitRuntime: (event: RuntimeEventInput) => void;
  },
) {
  const {
    provider,
    ctx,
    llmResponse,
    isDebug,
    emitRuntime,
  } = params;
  let assistantContent = llmResponse.content || '';

  try {
    assistantContent = await handleTruncation(
      provider,
      ctx.messages,
      llmResponse,
    );
    if (isDebug && assistantContent !== llmResponse.content) {
      emitRuntime({ type: 'debug', message: `Response auto-continued (truncation recovery): +${assistantContent.length - llmResponse.content.length} chars` });
    }
  } catch (err) {
    if (isDebug) {
      emitRuntime({ type: 'debug', message: `Truncation recovery failed: ${err instanceof Error ? err.message : String(err)}` });
    }
    assistantContent = llmResponse.content || '';
  }

  ctx.setToolCalls(llmResponse.tool_calls ?? []);
  const finalized = ctx.finalizeStream();
  return {
    finalContent: assistantContent || finalized.content,
    toolCalls: llmResponse.tool_calls ?? finalized.tool_calls ?? [],
  };
}

function detectLoopStall(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
  results: Array<{ success: boolean; output: string }>,
  loopState: NormalTurnLoopState,
): { stalled: boolean; nextState: NormalTurnLoopState } {
  const toolSignature = JSON.stringify(
    toolCalls.map((tc) => ({ name: tc.name, arguments: tc.arguments })),
  );
  const toolOutputSignature = JSON.stringify(
    results.map((r) => ({ success: r.success, output: r.output })),
  );
  const noProgressRounds = (
    toolSignature === loopState.lastToolSignature
    && toolOutputSignature === loopState.lastToolOutputSignature
  )
    ? loopState.noProgressRounds + 1
    : 0;

  return {
    stalled: noProgressRounds >= 3,
    nextState: {
      noProgressRounds,
      lastToolSignature: toolSignature,
      lastToolOutputSignature: toolOutputSignature,
    },
  };
}

/**
 * Handle a normal (non-skill) user turn.
 * User input -> LLM -> tool execution -> repeat until no tool_calls -> finish.
 */
export async function handle_normal_turn(
  options: HandleNormalTurnOptions,
): Promise<NormalTurnExecutionSummary> {
  const {
    taskType,
    session,
    provider,
    skillRegistry,
    approvalHook,
    toolContext,
    isDebug,
    runtime,
    turnId,
    runtimeMetadata,
    extraSystemMessages = [],
  } = options;
  const MAX_TOOL_ROUNDS = 16;
  let round = 0;
  let loopState: NormalTurnLoopState = {
    noProgressRounds: 0,
    lastToolSignature: '',
    lastToolOutputSignature: '',
  };
  const executedToolCalls: ToolCall[] = [];
  const executedToolResults: ToolResult[] = [];
  let aggregatedTokenUsage: AggregatedTokenUsage = {
    input: 0,
    output: 0,
    cache_creation: 0,
    cache_read: 0,
  };

  let ctx = prepareTurnContext(session, taskType, skillRegistry, extraSystemMessages);
  const emitRuntime = (event: RuntimeEventInput) => {
    runtime.emit(createRuntimeEvent(event, runtimeMetadata));
  };

  while (true) {
    round++;
      if (round > MAX_TOOL_ROUNDS) {
        const msg = `Tool loop exceeded max rounds (${MAX_TOOL_ROUNDS})`;
        emitRuntime({ type: 'error', message: msg });
        session.add_message({ role: 'assistant', content: `Error: ${msg}` });
        emitRuntime({ type: 'turn_completed', turnId, content: `Error: ${msg}`, finishReason: 'stop' });
        return { toolCalls: executedToolCalls, toolResults: executedToolResults };
      }

    if (needs_compression(session.messages, DEFAULT_COMPRESSION_CONFIG)) {
      await session.compact();
      ctx = prepareTurnContext(session, taskType, skillRegistry, extraSystemMessages);
    }

    try {
      const llm_response = await streamAssistantResponse({
        provider,
        ctx,
        isDebug,
        emitRuntime,
        turnId,
      });

      if (!llm_response) {
        const msg = 'LLM stream returned no response (possible server error)';
        emitRuntime({ type: 'error', message: msg });
        session.add_message({ role: 'assistant', content: `Error: ${msg}` });
        emitRuntime({ type: 'turn_completed', turnId, content: `Error: ${msg}`, finishReason: 'stop' });
        return { toolCalls: executedToolCalls, toolResults: executedToolResults };
      }

      const { finalContent, toolCalls } = await finalizeAssistantResponse({
        provider,
        ctx,
        llmResponse: llm_response,
        isDebug,
        emitRuntime,
      });
      aggregatedTokenUsage = mergeTokenUsage(aggregatedTokenUsage, llm_response.token_usage);

      if (!toolCalls || toolCalls.length === 0) {
        session.add_message({ role: 'assistant', content: finalContent });
        emitRuntime({ type: 'assistant_message', turnId, content: finalContent });
        emitRuntime({
          type: 'turn_completed',
          turnId,
          content: finalContent,
          finishReason: llm_response.finish_reason,
          tokenUsage: aggregatedTokenUsage,
        });
        return { toolCalls: executedToolCalls, toolResults: executedToolResults };
      }

      session.add_message({
        role: 'assistant',
        content: finalContent,
        tool_calls: toolCalls,
      });
      emitRuntime({ type: 'assistant_message', turnId, content: finalContent, toolCalls });

      const approvalRequestHandler = createApprovalRequestHandler({
        runtime,
        approvalHook,
        emitRuntime,
        turnId,
      });
      const results = await execute_tool_calls_parallel(
        toolCalls,
        toolContext,
        approvalHook,
        approvalRequestHandler,
        {
          onToolStart: (toolCall) => {
            emitRuntime({ type: 'tool_started', turnId, toolCall });
          },
          onToolEnd: (toolCall, result) => {
            emitRuntime({ type: 'tool_finished', turnId, toolCall, result });
          },
        },
      );
      executedToolCalls.push(...toolCalls);
      executedToolResults.push(...results);
      const stall = detectLoopStall(toolCalls, results, loopState);
      loopState = stall.nextState;
      if (stall.stalled) {
        const msg = 'Tool loop stopped: repeated identical tool calls/results with no progress';
        emitRuntime({ type: 'error', message: msg });
        session.add_message({ role: 'assistant', content: `Error: ${msg}` });
        emitRuntime({ type: 'turn_completed', turnId, content: `Error: ${msg}`, finishReason: 'stop' });
        return { toolCalls: executedToolCalls, toolResults: executedToolResults };
      }
      emitRuntime({ type: 'tool_batch_finished', turnId, toolCalls, results });

      for (let i = 0; i < results.length; i++) {
        const normalized = { ...results[i], tool_call_id: results[i].tool_call_id || toolCalls[i].id };
        session.add_message({
          role: 'tool',
          content: normalized.output,
          tool_results: [normalized],
        });
      }

      if (shouldCompact(session.messages, provider.get_model(), 0.8)) {
        if (isDebug) {
          const diagnostics = getContextDiagnostics(session.messages, provider.get_model());
          emitRuntime({ type: 'debug', message: `Proactive compaction: fill rate ${diagnostics.fillPercentage}` });
        }
        await session.compact();
      }

      // P1-6: 输出 token 使用统计
      if (isDebug) {
        const tokenStats = (session as any).getTokenStats?.(provider.get_model());
        if (tokenStats) {
          const warnStr = tokenStats.warn ? '⚠️' : '';
          emitRuntime({
            type: 'debug',
            message: `[Token] ${tokenStats.current}/${tokenStats.max} (${tokenStats.percentage}%) ${warnStr}`.trim(),
          });
        }
      }

      ctx = prepareTurnContext(session, taskType, skillRegistry, extraSystemMessages);
    } catch (err) {
      const formatted = formatLlmErrorMessage(err);
      emitRuntime({ type: 'error', message: formatted.logMessage });
      session.add_message({ role: 'assistant', content: formatted.userMessage });
      emitRuntime({ type: 'turn_completed', turnId, content: formatted.userMessage, finishReason: 'stop' });
      return { toolCalls: executedToolCalls, toolResults: executedToolResults };
    }
  }
}
