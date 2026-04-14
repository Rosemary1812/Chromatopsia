// T-24: repl/loop.ts — REPL 主循环
// 在线回路只服务用户：Skill 前置匹配 + LLM/tool 执行。
// 自学习由离线 LearningWorker 处理，不阻塞主对话。

import * as readline from 'node:readline';
import type {
  LLMProvider,
  LLMResponse,
  Session,
  AppConfig,
  AgentEvents,
  LogLevel,
  ProviderConfig,
} from '../foundation/types.js';
import { SessionManager } from '../session/manager.js';
import type { SessionHistory } from '../session/history.js';
import { build_llm_context } from '../session/context.js';
import { SkillRegistry } from '../skills/registry.js';
import { SkillStore } from '../skills/store.js';
import { ApprovalHook } from '../hooks/approval.js';
import { registry } from '../foundation/tools/registry.js';
import { register_all_tools } from '../foundation/tools/index.js';
import { execute_tool_calls_parallel } from './executor.js';
import { execute_skill } from './executor.js';
import { handle_slash_command as default_slash_handler } from './slash.js';
import { createProvider } from '../foundation/llm/index.js';
import { needs_compression, DEFAULT_COMPRESSION_CONFIG } from '../session/summarizer.js';
import { MemoryIndexStore } from '../memory/index-store.js';
import { MemoryTopicStore } from '../memory/topic-store.js';
import { buildMemoryInjection } from '../memory/injector.js';
import { maybeWriteMemory } from '../memory/writer.js';
import { TurnEventStore } from '../learning/turn-event-store.js';
import { LearningWorker } from '../learning/worker.js';
import { retryStreamWithBackoff } from '../foundation/llm/retry-handler.js';
import { handleTruncation } from '../foundation/llm/continuation.js';
import { shouldCompact, getContextDiagnostics } from '../foundation/llm/token-counter.js';
import * as os from 'node:os';
import * as path from 'node:path';

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export interface ReplOptions {
  /** Working directory for the session */
  working_dir: string;
  /** Provider type: 'anthropic' | 'openai'. Falls back to ANTHROPIC_API_KEY presence. */
  provider?: 'anthropic' | 'openai';
  /** Provider configuration (api_key, model, etc.). Falls back to env vars. */
  config?: {
    api_key?: string;
    base_url?: string;
    model?: string;
    max_tokens?: number;
    timeout?: number;
  };
  /** Optional app config (learning + other runtime settings) */
  app_config?: AppConfig;
  /** Custom readline interface (for testing) */
  readline_interface?: readline.Interface;
  /** Called when the loop exits */
  on_exit?: () => void;
  /** Slash command handler; defaults to built-in stub (no-op) */
  slash_handler?: (input: string, session: Session, skill_reg: SkillRegistry) => boolean;
  /** Event callbacks for output rendering. CLI/TUI implements these. */
  events?: AgentEvents;
  /** Log level for debug output. Default 'error'. */
  logLevel?: LogLevel;
}

export interface RunReplResult {
  /** Handle a user input turn (exposed for testing / Ink App) */
  handle_user_input: (input: string) => Promise<void>;
  /** Start the REPL (begins reading input) */
  start: () => Promise<never>;
}

// ------------------------------------------------------------
// Helper: infer task type from user input (simple heuristic)
// ------------------------------------------------------------

function infer_task_type(input: string): string {
  const q = input.toLowerCase().trim();
  // Very simple heuristic based on first word / keyword
  if (q.startsWith('fix') || q.includes('bug')) return 'fix-bug';
  if (q.startsWith('test')) return 'testing';
  if (q.startsWith('refactor') || q.includes('重构')) return 'refactor';
  if (q.startsWith('add') || q.includes('新增') || q.includes('实现')) return 'add-feature';
  if (q.includes('git')) return 'git';
  if (q.includes('deploy') || q.includes('发布')) return 'deploy';
  if (q.includes('docs') || q.includes('文档')) return 'docs';
  return 'general';
}

// ------------------------------------------------------------
// Main: run_repl
// ------------------------------------------------------------

/**
 * Run the REPL loop.
 *
 * @param options REPL configuration options
 * @returns RunReplResult with handle_user_input (for testing) and start() to begin
 */
export async function run_repl(options: ReplOptions): Promise<RunReplResult> {
  const {
    working_dir,
    provider: provider_type,
    config,
    app_config,
    readline_interface: customRl,
    on_exit,
    slash_handler = default_slash_handler,
    events = {},
    logLevel = 'error',
  } = options;

  // Fall back to env vars if not provided
  const resolvedProvider = provider_type
    ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : 'anthropic');
  const resolvedConfig: ProviderConfig = {
    api_key: config?.api_key ?? process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
    base_url: config?.base_url,
    model: config?.model,
    max_tokens: config?.max_tokens,
    timeout: config?.timeout,
  };

  const isDebug = logLevel === 'debug';

  function emit<K extends keyof AgentEvents>(event: K, ...args: Parameters<NonNullable<AgentEvents[K]>>) {
    const handler = events[event] as ((...a: unknown[]) => void) | undefined;
    handler?.(...args);
  }

  // ---- Register all built-in tools ----
  register_all_tools();

  // ---- Initialize components ----
  const provider = createProvider(resolvedProvider, resolvedConfig);
  const session_manager = new SessionManager(working_dir, provider);
  const session = session_manager.create_session(working_dir);
  const skill_reg = new SkillRegistry();
  const skill_store = new SkillStore();
  const approval_hook = new ApprovalHook();
  const memoryDir = path.join(os.homedir(), '.chromatopsia', 'memory');
  const memoryIndexStore = new MemoryIndexStore(memoryDir);
  const memoryTopicStore = new MemoryTopicStore(memoryDir);
  const turnEventStore = new TurnEventStore();

  // Load persisted skills into registry
  await skill_store.load();
  for (const entry of skill_store.getManifest()) {
    skill_reg.register_manifest(entry);
  }
  for (const skill of skill_store.getAll()) {
    skill_reg.register(skill);
  }

  const learningEnabled = app_config?.learning?.enabled !== false;
  const learningBatchTurns = app_config?.learning?.batch_turns ?? 20;
  const learningMinConfidence = app_config?.learning?.min_confidence ?? 0.75;
  const reminderEnabled = app_config?.learning?.reminder?.enabled !== false;
  const reminderMaxPerSession = app_config?.learning?.reminder?.max_per_session ?? 3;
  let reminderShown = 0;
  const historyGetter = (session_manager as unknown as { get_history?: () => SessionHistory }).get_history;
  const history = typeof historyGetter === 'function'
    ? historyGetter.call(session_manager)
    : null;
  const learningWorker = learningEnabled
    && history !== null
    ? new LearningWorker({
        provider,
        session,
        history,
        skillStore: skill_store,
        skillRegistry: skill_reg,
        eventStore: turnEventStore,
      }, learningBatchTurns, learningMinConfidence)
    : null;

  // ---- Tool context ----
  const tool_context: import('../foundation/types.js').ToolContext = {
    session,
    working_directory: working_dir,
  };

  // ---- Readline setup ----
  let rl: readline.Interface | null = customRl ?? null;

  function make_rl_promise(): Promise<string> {
    return new Promise<string>((resolve) => {
      if (!rl) {
        resolve('');
        return;
      }
      rl.question('> ', (answer) => {
        resolve(answer ?? '');
      });
    });
  }

  // ------------------------------------------------------------
  // handle_user_input — processes one user input turn
  // ------------------------------------------------------------

  /**
   * Process a single user input turn.
   * Called by the main loop (stdin) or by tests.
   */
  async function handle_user_input(input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) return;

    session.add_message({ role: 'user', content: trimmed });
    let turnTaskType = infer_task_type(trimmed);

    if (await handle_learning_command(trimmed)) {
      return;
    }

    // Slash command handling (before skill matching)
    if (slash_handler(trimmed, session, skill_reg)) {
      return;
    }

    // Skill pre-match: trigger_match() on user input
    const matched_skill = skill_reg.trigger_match(trimmed);
    if (matched_skill) {
      turnTaskType = matched_skill.task_type;
      const results = await execute_skill(matched_skill, tool_context, approval_hook);
      for (const result of results) {
        if (result.success) {
          emit('onNotification', `[${matched_skill.name}] Step succeeded`);
        } else {
          emit('onNotification', `[${matched_skill.name}] Step failed: ${result.output}`);
        }
      }
      session.add_message({
        role: 'assistant',
        content: `Executed skill: ${matched_skill.name} (${results.length} steps)`,
      });
      try {
        await maybeWriteMemory(trimmed, session, provider, memoryIndexStore, memoryTopicStore);
      } catch {
        // best-effort memory write
      }
      emit('onTurnComplete', `Executed skill: ${matched_skill.name}`);
      void maybe_schedule_learning(turnTaskType, trimmed);
      return;
    }

    // Normal turn: LLM → tool execution loop
    let memorySystemMessages: import('../foundation/types.js').Message[] = [];
    try {
      const memoryInjection = await buildMemoryInjection(trimmed, memoryIndexStore, memoryTopicStore);
      memorySystemMessages = memoryInjection.systemMessages;
    } catch {
      // best-effort memory injection
      memorySystemMessages = [];
    }
    await handle_normal_turn(
      trimmed, session, provider, skill_reg, approval_hook, tool_context,
      isDebug, emit, memorySystemMessages, events,
    );
    try {
      await maybeWriteMemory(trimmed, session, provider, memoryIndexStore, memoryTopicStore);
    } catch {
      // best-effort memory write
    }
    void maybe_schedule_learning(turnTaskType, trimmed);
  }

  async function handle_learning_command(input: string): Promise<boolean> {
    if (!input.startsWith('/skill')) return false;
    const parts = input.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return false;
    const sub = parts[1];

    if (sub === 'review') {
      const drafts = skill_store.list_drafts();
      if (drafts.length === 0) {
        emit('onTurnComplete', 'No draft skills pending review.');
      } else {
        const lines = drafts.map((d) => `- ${d.id}: ${d.name} [${d.task_type}]`);
        emit('onTurnComplete', ['Draft skills pending review:', ...lines].join('\n'));
      }
      return true;
    }

    if ((sub === 'approve' || sub === 'reject') && parts.length >= 3) {
      const id = parts[2];
      if (sub === 'approve') {
        const approved = await skill_store.approve_draft(id);
        if (!approved) {
          emit('onTurnComplete', `Draft "${id}" not found.`);
          return true;
        }
        skill_reg.register_manifest({
          id: approved.id,
          name: approved.name,
          description: approved.trigger_condition,
          triggers: [approved.trigger_condition],
          trigger_pattern: approved.trigger_pattern,
          task_type: approved.task_type,
          scope: 'user',
          enabled: true,
          priority: 50,
          version: 1,
          updated_at: new Date(approved.updated_at).toISOString(),
          source_path: `.chromatopsia/skills/user/${approved.id}.md`,
        });
        skill_reg.register(approved);
        emit('onTurnComplete', `Draft approved and published: ${approved.name}`);
        return true;
      }
      const rejected = await skill_store.reject_draft(id);
      emit('onTurnComplete', rejected ? `Draft rejected: ${id}` : `Draft "${id}" not found.`);
      return true;
    }

    return false;
  }

  async function maybe_schedule_learning(taskType: string, userInput: string): Promise<void> {
    if (!learningWorker) return;
    const result = await learningWorker.onTurnCompleted(taskType, userInput);
    if (result.triggered && result.draftName) {
      emit('onNotification', `Draft skill generated: ${result.draftName}`);
    }
    if (!reminderEnabled || reminderShown >= reminderMaxPerSession) return;
    const drafts = typeof skill_store.list_drafts === 'function' ? skill_store.list_drafts() : [];
    if (drafts.length > 0) {
      reminderShown++;
      emit('onNotification', `[Learning] ${drafts.length} draft(s) pending review`);
    }
  }

  // ------------------------------------------------------------
  // Main loop: strictly input-driven
  // ------------------------------------------------------------

  let running = true;
  /** 正在执行中的 turn，串行化防止并发导致 session 状态错乱 */
  let turnPromise: Promise<void> = Promise.resolve();

  async function main_loop(): Promise<never> {
    if (isDebug) emit('onDebug', 'main_loop started');

    if (!rl) {
      if (!process.stdin.isTTY) {
        emit('onError', 'REPL requires an interactive terminal (TTY).');
        process.exit(1);
      }

      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '> ',
      });
      rl.on('close', () => {
        running = false;
        on_exit?.();
      });
    }

    emit('onNotification', 'REPL ready. Type /help for commands.');

    while (running) {
      try {
        const input_value = await make_rl_promise();
        turnPromise = turnPromise.then(() => handle_user_input(input_value));
        await turnPromise;
      } catch {
        // readline error — exit
        break;
      }
    }

    on_exit?.();
    process.exit(0);
  }

  return {
    handle_user_input,
    start: main_loop,
  };
}

// ------------------------------------------------------------
// handle_normal_turn — Normal execution state
// ------------------------------------------------------------

/**
 * Handle a normal (non-skill) user turn.
 * User input → LLM → tool execution → repeat until no tool_calls → finish.
 */
async function handle_normal_turn(
  input: string,
  session: Session,
  provider: LLMProvider,
  skill_reg: SkillRegistry,
  approval_hook: ApprovalHook,
  tool_context: import('../foundation/types.js').ToolContext,
  isDebug: boolean,
  emit: <K extends keyof AgentEvents>(event: K, ...args: Parameters<NonNullable<AgentEvents[K]>>) => void,
  extra_system_messages: import('../foundation/types.js').Message[] = [],
  events: AgentEvents = {},
): Promise<void> {
  const task_type = infer_task_type(input);
  const MAX_TOOL_ROUNDS = 16;
  const MAX_NO_PROGRESS_ROUNDS = 3;
  let round = 0;
  let noProgressRounds = 0;
  let lastToolSignature = '';
  let lastToolOutputSignature = '';

  // Build initial LLM context
  let ctx = build_llm_context(session, task_type, null, skill_reg, extra_system_messages);

  // Tool execution loop
  while (true) {
    round++;
    if (round > MAX_TOOL_ROUNDS) {
      const msg = `Tool loop exceeded max rounds (${MAX_TOOL_ROUNDS})`;
      emit('onError', msg);
      session.add_message({ role: 'assistant', content: `Error: ${msg}` });
      emit('onTurnComplete', `Error: ${msg}`);
      return;
    }

    // Auto-compression: check if session needs compression before LLM call
    if (needs_compression(session.messages, DEFAULT_COMPRESSION_CONFIG)) {
      await session.compact();
    }

    // Stream LLM response with retry support
    let llm_response: LLMResponse | null = null;

    const STREAM_TIMEOUT_MS = 60_000; // 60s timeout per turn

    try {
      if (isDebug) {
        emit('onDebug', `ctx.messages count: ${ctx.messages.length}`);
        for (const m of ctx.messages) {
          emit('onDebug', `msg role=${m.role} content_len=${m.content.length}`);
        }
        emit('onDebug', 'calling chat_stream with retry support...');
      }

      // Wrap streaming with exponential backoff retry (max 3 attempts)
      const retryableGen = retryStreamWithBackoff(
        () => provider.chat_stream(ctx.messages, registry.get_all()),
        { maxRetries: 3, initialDelayMs: 1000 }
      );

      let result: IteratorResult<string, LLMResponse>;
      while (true) {
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
          timeoutId = setTimeout(() => {
            emit('onDebug', 'Stream timeout after 60s, forcing close...');
            resolve({ timedOut: true });
          }, STREAM_TIMEOUT_MS);
        });
        const nextPromise = retryableGen.next();

        const raceResult = await Promise.race([nextPromise, timeoutPromise]);
        clearTimeout(timeoutId!);

        if ('timedOut' in raceResult) {
          const msg = 'Stream timeout (60s) — server did not respond';
          emit('onError', msg);
          session.add_message({ role: 'assistant', content: `Error: ${msg}` });
          emit('onTurnComplete', `Error: ${msg}`);
          return;
        }

        result = raceResult;
        if (result.done) {
          llm_response = result.value;
          break;
        }

        const chunk = result.value;
        ctx.appendAssistantChunk(chunk);
        emit('onStreamChunk', chunk);
      }
      emit('onStreamChunk', '\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit('onError', `LLM Error: ${msg}`);
      session.add_message({ role: 'assistant', content: `Error: ${msg}` });
      emit('onTurnComplete', `Error: ${msg}`);
      return;
    }

    // Guard: stream may have ended silently (e.g. SDK swallowed an HTTP error).
    // If llm_response is null/undefined, treat as error.
    if (!llm_response) {
      const msg = 'LLM stream returned no response (possible server error)';
      emit('onError', msg);
      session.add_message({ role: 'assistant', content: `Error: ${msg}` });
      emit('onTurnComplete', `Error: ${msg}`);
      return;
    }

    // Handle truncation recovery: check if response was cut off, auto-continue if needed
    let assistantContent = llm_response.content || '';
    try {
      assistantContent = await handleTruncation(
        provider,
        ctx.messages,
        llm_response,
      );
      if (isDebug && assistantContent !== llm_response.content) {
        emit('onDebug', `Response auto-continued (truncation recovery): +${assistantContent.length - llm_response.content.length} chars`);
      }
    } catch (err) {
      if (isDebug) {
        emit('onDebug', `Truncation recovery failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      // Fall back to original content if continuation fails
      assistantContent = llm_response.content || '';
    }

    // Use streamed chunks as canonical fallback when provider return content is unexpectedly empty.
    ctx.setToolCalls(llm_response.tool_calls ?? []);
    const finalized = ctx.finalizeStream();
    const finalContent = assistantContent || finalized.content;
    const toolCalls = llm_response.tool_calls ?? finalized.tool_calls ?? [];

    // No tool_calls → output text and end turn
    if (!toolCalls || toolCalls.length === 0) {
      session.add_message({ role: 'assistant', content: finalContent });
      emit('onTurnComplete', finalContent);
      break;
    }

    // Persist assistant tool-call turn so next LLM call has a complete protocol transcript.
    session.add_message({
      role: 'assistant',
      content: finalContent,
      tool_calls: toolCalls,
    });

    // Execute tool calls
    const results = await execute_tool_calls_parallel(
      toolCalls,
      tool_context,
      approval_hook,
      events.onApprovalRequest,
    );
    const toolSignature = JSON.stringify(
      toolCalls.map((tc) => ({ name: tc.name, arguments: tc.arguments })),
    );
    const toolOutputSignature = JSON.stringify(
      results.map((r) => ({ success: r.success, output: r.output })),
    );
    if (toolSignature === lastToolSignature && toolOutputSignature === lastToolOutputSignature) {
      noProgressRounds++;
    } else {
      noProgressRounds = 0;
    }
    lastToolSignature = toolSignature;
    lastToolOutputSignature = toolOutputSignature;
    if (noProgressRounds >= MAX_NO_PROGRESS_ROUNDS) {
      const msg = 'Tool loop stopped: repeated identical tool calls/results with no progress';
      emit('onError', msg);
      session.add_message({ role: 'assistant', content: `Error: ${msg}` });
      emit('onTurnComplete', `Error: ${msg}`);
      return;
    }
    emit('onToolBatchEnd', toolCalls, results);
    for (let i = 0; i < toolCalls.length; i++) {
      emit('onToolStart', toolCalls[i]);
      emit('onToolEnd', toolCalls[i], results[i]);
    }

    // Inject tool results to session for persistence and next LLM context
    // The context will be rebuilt in the next loop iteration via build_llm_context
    for (let i = 0; i < results.length; i++) {
      const normalized = { ...results[i], tool_call_id: results[i].tool_call_id || toolCalls[i].id };
      session.add_message({
        role: 'tool',
        content: normalized.output,
        tool_results: [normalized],
      });
    }

    // Proactive compaction: check context fill rate, compact if ≥80%
    if (shouldCompact(session.messages, provider.get_model(), 0.8)) {
      if (isDebug) {
        const diagnostics = getContextDiagnostics(session.messages, provider.get_model());
        emit('onDebug', `Proactive compaction: fill rate ${diagnostics.fillPercentage}`);
      }
      await session.compact();
    }

    // Rebuild context for next LLM call (includes tool results from session)
    ctx = build_llm_context(session, task_type, null, skill_reg, extra_system_messages);
  }
}
