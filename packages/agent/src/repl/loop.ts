// T-24: repl/loop.ts — REPL 主循环
// 双状态机：Normal（普通执行） / Reflection（技能合成）
// Skill 前置匹配：每次输入先 trigger_match()，匹配到则执行 Skill 不调 LLM

import * as readline from 'node:readline';
import type {
  LLMProvider,
  LLMResponse,
  Session,
  AppConfig,
  AgentEvents,
  LogLevel,
} from '../foundation/types.js';
import { SessionManager } from '../agent/session/manager.js';
import { build_llm_context } from '../agent/session/context.js';
import { SkillRegistry } from '../skills/registry.js';
import { SkillPatcher } from '../skills/patcher.js';
import { SkillStore } from '../skills/store.js';
import { ApprovalHook } from '../hooks/approval.js';
import { registry } from '../foundation/tools/registry.js';
import { register_all_tools } from '../foundation/tools/index.js';
import { execute_tool_calls_parallel } from './executor.js';
import { execute_skill } from './executor.js';
import { handle_slash_command as default_slash_handler } from './slash.js';
import {
  create_reflection_state,
  update_last_active,
  add_to_task_buffer,
  should_trigger_reflection,
  reset_reflection,
  run_idle_reflection,
  synthesize_skill,
  start_reflection,
} from './reflection.js';
import { createProvider } from '../foundation/llm/index.js';
import { needs_compression, DEFAULT_COMPRESSION_CONFIG } from '../agent/session/summarizer.js';
import { MemoryIndexStore } from '../memory/index-store.js';
import { MemoryTopicStore } from '../memory/topic-store.js';
import { buildMemoryInjection } from '../memory/injector.js';
import { maybeWriteMemory } from '../memory/writer.js';
import * as os from 'node:os';
import * as path from 'node:path';

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export interface ReplOptions {
  /** Working directory for the session */
  working_dir: string;
  /** Provider type: 'anthropic' | 'openai' */
  provider: 'anthropic' | 'openai';
  /** Provider configuration (api_key, model, etc.) */
  config: {
    api_key: string;
    base_url?: string;
    model?: string;
    max_tokens?: number;
    timeout?: number;
  };
  /** Optional app config (for reflection idle_timeout) */
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
// Constants
// ------------------------------------------------------------

const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_REFLECTION_THRESHOLD = 3;

// ------------------------------------------------------------
// Helper: delay promise
// ------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const isDebug = logLevel === 'debug';

  function emit<K extends keyof AgentEvents>(event: K, ...args: Parameters<NonNullable<AgentEvents[K]>>) {
    const handler = events[event] as ((...a: unknown[]) => void) | undefined;
    handler?.(...args);
  }

  // ---- Register all built-in tools ----
  register_all_tools();

  // ---- Initialize components ----
  const provider = createProvider(provider_type, config);
  const session_manager = new SessionManager(working_dir, provider);
  const session = session_manager.create_session(working_dir);
  const skill_reg = new SkillRegistry();
  const skill_patcher = new SkillPatcher();
  const skill_store = new SkillStore();
  const approval_hook = new ApprovalHook();
  const memoryDir = path.join(os.homedir(), '.chromatopsia', 'memory');
  const memoryIndexStore = new MemoryIndexStore(memoryDir);
  const memoryTopicStore = new MemoryTopicStore(memoryDir);

  // Load persisted skills into registry
  await skill_store.load();
  for (const entry of skill_store.getManifest()) {
    skill_reg.register_manifest(entry);
  }
  for (const skill of skill_store.getAll()) {
    skill_reg.register(skill);
  }

  // ---- Reflection state (maintained across turns) ----
  let reflection = create_reflection_state();

  // ---- Configurable thresholds ----
  const idle_timeout =
    app_config?.reflection?.enabled === false
      ? Infinity
      : app_config?.reflection?.idle_timeout ?? DEFAULT_IDLE_TIMEOUT_MS;

  const reflection_threshold =
    app_config?.reflection?.threshold ?? DEFAULT_REFLECTION_THRESHOLD;

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

    update_last_active(reflection);
    session.add_message({ role: 'user', content: trimmed });

    // Slash command handling (before skill matching)
    if (slash_handler(trimmed, session, skill_reg)) {
      return;
    }

    // Skill pre-match: trigger_match() on user input
    const matched_skill = skill_reg.trigger_match(trimmed);
    if (matched_skill) {
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
      trimmed, session, provider, skill_reg, skill_patcher, skill_store,
      approval_hook, tool_context, reflection, reflection_threshold,
      isDebug, emit, memorySystemMessages,
    );
    try {
      await maybeWriteMemory(trimmed, session, provider, memoryIndexStore, memoryTopicStore);
    } catch {
      // best-effort memory write
    }
  }

  // ------------------------------------------------------------
  // Main loop: Promise.race([readline, idle_timeout])
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
      // Race: user input vs idle timeout
      const input_promise = make_rl_promise();
      const idle_promise = idle_timeout === Infinity ? new Promise<never>(() => {}) : delay(idle_timeout);

      let result: 'input' | 'idle';
      let input_value = '';
      try {
        const winner = await Promise.race([input_promise, idle_promise]);
        if (typeof winner === 'string') {
          result = 'input';
          input_value = winner;
        } else {
          result = 'idle';
        }
      } catch {
        // readline error — exit
        break;
      }

      if (result === 'input') {
        // 严格串行：本轮 turn 完成前，不允许进入下一次输入读取
        turnPromise = turnPromise.then(() => handle_user_input(input_value));
        await turnPromise;
      } else {
        // Idle timeout — 也要等当前 turn 结束
        await turnPromise;
        const synthesis = await run_idle_reflection(reflection, idle_timeout);
        if (synthesis && reflection.task_buffer.length > 0) {
          // Conditions met: run actual synthesis via LLM
          const synthesis_result = await synthesize_skill(reflection, provider, skill_reg);
          if (synthesis_result.skill && Object.keys(synthesis_result.skill).length > 0) {
            start_reflection(reflection);
            const new_skill = synthesis_result.skill as import('../foundation/types.js').Skill;
            await skill_patcher.patch(new_skill, reflection.task_buffer);
            skill_reg.register(new_skill);
            await skill_store.save(new_skill);
            emit('onNotification', `New skill generated: ${new_skill.name}`);
          }
        }
        if (reflection.task_buffer.length > 0) {
          reflection = reset_reflection(reflection);
        }
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
  skill_patcher: SkillPatcher,
  skill_store: SkillStore,
  approval_hook: ApprovalHook,
  tool_context: import('../foundation/types.js').ToolContext,
  reflection: import('../foundation/types.js').ReflectionState,
  reflection_threshold: number,
  isDebug: boolean,
  emit: <K extends keyof AgentEvents>(event: K, ...args: Parameters<NonNullable<AgentEvents[K]>>) => void,
  extra_system_messages: import('../foundation/types.js').Message[] = [],
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

    // Stream LLM response
    let llm_response: LLMResponse | null = null;

    const STREAM_TIMEOUT_MS = 60_000; // 60s timeout per turn

    try {
      if (isDebug) {
        emit('onDebug', `ctx.messages count: ${ctx.messages.length}`);
        for (const m of ctx.messages) {
          emit('onDebug', `msg role=${m.role} content_len=${m.content.length}`);
        }
        emit('onDebug', 'calling chat_stream...');
      }
      const gen = provider.chat_stream(ctx.messages, registry.get_all());
      let result: IteratorResult<string, LLMResponse>;
      while (true) {
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
          timeoutId = setTimeout(() => {
            emit('onDebug', 'Stream timeout after 60s, forcing close...');
            resolve({ timedOut: true });
          }, STREAM_TIMEOUT_MS);
        });
        const nextPromise = gen.next();

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

    // Use streamed chunks as canonical fallback when provider return content is unexpectedly empty.
    ctx.setToolCalls(llm_response.tool_calls ?? []);
    const finalized = ctx.finalizeStream();
    const assistantContent = llm_response.content || finalized.content;
    const toolCalls = llm_response.tool_calls ?? finalized.tool_calls ?? [];

    // No tool_calls → output text and end turn
    if (!toolCalls || toolCalls.length === 0) {
      session.add_message({ role: 'assistant', content: assistantContent });
      emit('onTurnComplete', assistantContent);
      break;
    }

    // Persist assistant tool-call turn so next LLM call has a complete protocol transcript.
    session.add_message({
      role: 'assistant',
      content: assistantContent,
      tool_calls: toolCalls,
    });

    // Execute tool calls
    const results = await execute_tool_calls_parallel(
      toolCalls,
      tool_context,
      approval_hook,
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

    // Record in task buffer (for reflection)
    add_to_task_buffer(reflection, {
      tool_calls: toolCalls,
      tool_results: results,
      task_type,
      session_id: session.id,
      timestamp: Date.now(),
    });

    // Check reflection trigger
    if (should_trigger_reflection(reflection, task_type, reflection_threshold)) {
      // Run synthesis
      const synthesis = await synthesize_skill(reflection, provider, skill_reg);
      if (synthesis.skill && Object.keys(synthesis.skill).length > 0) {
        start_reflection(reflection);
        const new_skill = synthesis.skill as import('../foundation/types.js').Skill;
        await skill_patcher.patch(new_skill, reflection.task_buffer);
        skill_reg.register(new_skill);
        await skill_store.save(new_skill);
        emit('onNotification', `New skill generated: ${new_skill.name}`);
      }
      reflection = reset_reflection(reflection);
    }

    // Inject tool results and loop again
    // Add tool results to session so next build_llm_context sees them
    for (let i = 0; i < results.length; i++) {
      const normalized = { ...results[i], tool_call_id: results[i].tool_call_id || toolCalls[i].id };
      session.add_message({
        role: 'tool',
        content: normalized.output,
        tool_results: [normalized],
      });
    }
    ctx.messages = [
      ...ctx.messages,
      { role: 'assistant', content: assistantContent, tool_calls: toolCalls },
      ...results.map((r, i) => {
        const normalized = { ...r, tool_call_id: r.tool_call_id || toolCalls[i].id };
        return {
          role: 'tool' as const,
          content: normalized.output,
          tool_results: [normalized],
        };
      }),
    ];
  }
}
