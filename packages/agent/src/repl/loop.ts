// T-24: repl/loop.ts — REPL 主循环
// 在线回路只服务用户：Skill 前置匹配 + LLM/tool 执行。
// 自学习由离线 LearningWorker 处理，不阻塞主对话。

import * as readline from 'node:readline';
import { randomUUID } from 'crypto';
import type {
  LLMProvider,
  LLMResponse,
  Session,
  AppConfig,
  AgentEvents,
  LogLevel,
  ProviderConfig,
  ProviderType,
  RuntimeAgentRole,
  RuntimeSink,
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
import { createProvider, resolveProviderConfig, normalizeProviderType } from '../foundation/llm/index.js';
import { load_config } from '../config/loader.js';
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
import { createRuntimeEvent, createRuntimeSinkFromAgentEvents } from './runtime.js';
import type { RuntimeEventInput } from './runtime.js';
import { resolveStoragePaths } from '../storage/paths.js';

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------

export interface ReplOptions {
  /** Working directory for the session */
  working_dir: string;
  /** Provider type alias. Falls back to config.yaml or environment variables. */
  provider?: ProviderType;
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
  /** Runtime metadata for current agent instance. */
  agentId?: string;
  agentRole?: RuntimeAgentRole;
}

export interface RunReplResult {
  /** Handle a user input turn (exposed for testing / Ink App) */
  handle_user_input: (input: string) => Promise<void>;
  /** Clear current session conversation */
  clear_conversation: () => void;
  /** Start the REPL (begins reading input) */
  start: () => Promise<never>;
}

export interface AgentRuntimeOptions {
  working_dir: string;
  config_path?: string;
  provider?: ProviderType;
  config?: {
    api_key?: string;
    base_url?: string;
    model?: string;
    max_tokens?: number;
    timeout?: number;
  };
  app_config?: AppConfig;
  slash_handler?: (input: string, session: Session, skill_reg: SkillRegistry) => boolean;
  runtime?: RuntimeSink;
  logLevel?: LogLevel;
  agentId?: string;
  agentRole?: RuntimeAgentRole;
}

export interface AgentRuntimeResult {
  handle_user_input: (input: string) => Promise<void>;
  clear_conversation: () => void;
  list_slash_commands: () => Array<{ input: string; description: string }>;
  list_draft_skills: () => Array<{ id: string; name: string; task_type: string }>;
  get_skill_load_message: () => string | null;
}

function build_skill_slash_aliases(skill: import('../foundation/types.js').Skill): string[] {
  const aliases = new Set<string>([`/${skill.id}`]);
  const slashMatches = skill.trigger_pattern?.match(/\/[A-Za-z0-9][A-Za-z0-9_-]*/g) ?? [];
  for (const match of slashMatches) {
    aliases.add(match);
  }
  return [...aliases];
}

function build_skill_load_message(entries: import('../foundation/types.js').SkillManifestEntry[]): string | null {
  if (entries.length === 0) return null;

  let builtin = 0;
  let user = 0;
  let drafts = 0;

  for (const entry of entries) {
    if (entry.scope === 'builtin') builtin++;
    if (entry.scope === 'user' || entry.scope === 'project') user++;
    if (entry.scope === 'learning_draft') drafts++;
  }

  const enabled = entries.filter((entry) => entry.scope !== 'learning_draft' && entry.enabled !== false);
  return `Loaded ${entries.length} skills (${builtin} builtin, ${user} user, ${drafts} draft; ${enabled.length} active).`;
}

function summarize_skill_results(
  skill: import('../foundation/types.js').Skill,
  results: import('../foundation/types.js').ToolResult[],
): string {
  if (results.length === 0) {
    return `Skill "${skill.name}" ran, but it produced no step results.`;
  }

  const failed: Array<{ index: number; result: import('../foundation/types.js').ToolResult }> = [];
  const succeeded: Array<{ index: number; result: import('../foundation/types.js').ToolResult }> = [];

  for (const [index, result] of results.entries()) {
    if (result.success) {
      succeeded.push({ index, result });
    } else {
      failed.push({ index, result });
    }
  }

  const lines: string[] = [];
  if (failed.length > 0) {
    lines.push(`Skill "${skill.name}" failed.`);
    for (const item of failed) {
      const output = item.result.output?.trim() || 'Unknown error.';
      lines.push(`- Step ${item.index + 1} failed: ${output}`);
    }
    if (succeeded.length > 0) {
      lines.push(`Succeeded steps: ${succeeded.map((item) => item.index + 1).join(', ')}`);
    }
    return lines.join('\n');
  }

  lines.push(`Skill "${skill.name}" completed successfully.`);
  for (const item of succeeded) {
    const output = item.result.output?.trim();
    lines.push(`- Step ${item.index + 1}: ${output || 'Done.'}`);
  }
  return lines.join('\n');
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
// Main: create_agent_runtime / run_repl
// ------------------------------------------------------------

export async function create_agent_runtime(options: AgentRuntimeOptions): Promise<AgentRuntimeResult> {
  const {
    working_dir,
    config_path,
    provider: provider_type,
    config,
    app_config,
    slash_handler = default_slash_handler,
    runtime,
    logLevel = 'error',
    agentId = 'main',
    agentRole = 'main',
  } = options;

  const loadedAppConfig = app_config ?? (config_path ? await load_config(config_path) : undefined);

  // Fall back to config file and env vars if not provided
  const resolvedProvider: ProviderType = provider_type
    ?? loadedAppConfig?.provider
    ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : 'anthropic');
  const providerConfigFromApp = resolveProviderConfig(loadedAppConfig, resolvedProvider);
  const providerFamily = normalizeProviderType(resolvedProvider);
  const defaultApiKey = providerFamily === 'anthropic'
    ? process.env.ANTHROPIC_API_KEY ?? process.env.CLAUDE_API_KEY ?? ''
    : process.env.OPENAI_API_KEY ?? process.env.CODEX_API_KEY ?? '';
  const resolvedConfig: ProviderConfig = {
    api_key: config?.api_key ?? providerConfigFromApp?.api_key ?? defaultApiKey,
    base_url: config?.base_url ?? providerConfigFromApp?.base_url,
    model: config?.model ?? providerConfigFromApp?.model,
    max_tokens: config?.max_tokens ?? providerConfigFromApp?.max_tokens,
    timeout: config?.timeout ?? providerConfigFromApp?.timeout,
  };

  const isDebug = logLevel === 'debug';
  const runtimeSink: RuntimeSink = runtime ?? {
    emit: () => {},
  };
  const runtimeMetadata = { agentId, agentRole };
  const emitRuntime = (event: RuntimeEventInput) => {
    runtimeSink.emit(createRuntimeEvent(event, runtimeMetadata));
  };

  // ---- Register all built-in tools ----
  register_all_tools();

  // ---- Initialize components ----
  const provider = createProvider(resolvedProvider, resolvedConfig);
  const storagePaths = resolveStoragePaths({
    workingDir: working_dir,
    appConfig: loadedAppConfig,
    configPath: config_path,
  });
  const session_manager = new SessionManager(storagePaths.sessionsDir, provider);
  const session = session_manager.create_session(working_dir);
  const skill_reg = new SkillRegistry();
  const skill_store = new SkillStore({
    indexPath: storagePaths.skillsIndexPath,
    runtimeSkillsRoot: storagePaths.skillsDir,
    builtinSkillsRoots: storagePaths.builtinSkillsRoots,
    enableBuiltin: true,
    cwd: storagePaths.projectRoot,
  });
  const approval_hook = new ApprovalHook({
    auto_approve_safe: loadedAppConfig?.approval?.auto_approve_safe ?? true,
    timeout_ms: (loadedAppConfig?.approval?.timeout_seconds ?? 300) * 1000,
  });
  const memoryIndexStore = new MemoryIndexStore(storagePaths.memoryDir);
  const memoryTopicStore = new MemoryTopicStore(storagePaths.memoryDir);
  const turnEventStore = new TurnEventStore({ baseDir: storagePaths.learningDir });

  // Load persisted skills into registry
  await skill_store.load();
  for (const entry of skill_store.getManifest()) {
    skill_reg.register_manifest(entry);
  }
  for (const skill of skill_store.getAll()) {
    skill_reg.register(skill);
  }

  const learningEnabled = loadedAppConfig?.learning?.enabled !== false;
  const learningBatchTurns = loadedAppConfig?.learning?.batch_turns ?? 20;
  const learningMinConfidence = loadedAppConfig?.learning?.min_confidence ?? 0.75;
  const reminderEnabled = loadedAppConfig?.learning?.reminder?.enabled !== false;
  const reminderMaxPerSession = loadedAppConfig?.learning?.reminder?.max_per_session ?? 3;
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

  const build_runtime_skill_commands = () => {
    const manifestById = new Map(skill_store.getManifest().map((entry) => [entry.id, entry]));
    const commands = new Map<string, { input: string; description: string }>();

    for (const skill of skill_store.getAll()) {
      const manifest = manifestById.get(skill.id);
      if (!manifest || manifest.scope === 'learning_draft' || manifest.enabled === false) {
        continue;
      }
      for (const alias of build_skill_slash_aliases(skill)) {
        const key = alias.toLowerCase();
        if (!commands.has(key)) {
          commands.set(key, {
            input: alias,
            description: `Run skill: ${skill.name}`,
          });
        }
      }
    }

    return [...commands.values()].sort((left, right) => left.input.localeCompare(right.input));
  };

  const resolve_skill_from_slash_input = (input: string) => {
    const firstToken = input.trim().split(/\s+/, 1)[0]?.toLowerCase();
    if (!firstToken?.startsWith('/')) return null;

    const skillsById = new Map(skill_store.getAll().map((skill) => [skill.id, skill]));

    for (const entry of skill_store.getManifest()) {
      if (entry.scope === 'learning_draft' || entry.enabled === false) continue;
      const skill = skillsById.get(entry.id);
      if (!skill) continue;

      for (const alias of build_skill_slash_aliases(skill)) {
        if (alias.toLowerCase() === firstToken) {
          return skill;
        }
      }
    }

    return null;
  };

  const list_runtime_drafts = () =>
    skill_store.list_drafts().map((skill) => ({
      id: skill.id,
      name: skill.name,
      task_type: skill.task_type,
    }));

  // ---- Tool context ----
  const tool_context: import('../foundation/types.js').ToolContext = {
    session,
    working_directory: working_dir,
  };

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
    const turnId = randomUUID();

    emitRuntime({ type: 'turn_started', turnId, text: trimmed });
    session.add_message({ role: 'user', content: trimmed });
    let turnTaskType = infer_task_type(trimmed);

    if (await handle_learning_command(trimmed, turnId)) {
      return;
    }

    // Slash command handling (before skill matching)
    if (slash_handler(trimmed, session, skill_reg)) {
      return;
    }

    // Skill pre-match: trigger_match() on user input
    const matched_skill = resolve_skill_from_slash_input(trimmed) ?? skill_reg.trigger_match(trimmed);
    if (matched_skill) {
      turnTaskType = matched_skill.task_type;
      const skillApprovalRequestHandler = async (request: import('../foundation/types.js').ApprovalRequest) => {
        emitRuntime({ type: 'approval_requested', turnId, request });
        const decision = runtimeSink.requestApproval
          ? await runtimeSink.requestApproval(request)
          : await approval_hook.wait_for_decision(request.id);
        emitRuntime({ type: 'approval_resolved', turnId, requestId: request.id, decision: decision.decision });
        return decision;
      };
      const skillToolCalls: import('../foundation/types.js').ToolCall[] = [];
      const results = await execute_skill(
        matched_skill,
        tool_context,
        approval_hook,
        skillApprovalRequestHandler,
        {
          onToolStart: (toolCall) => {
            skillToolCalls.push(toolCall);
            emitRuntime({ type: 'tool_started', turnId, toolCall });
          },
          onToolEnd: (toolCall, result) => {
            emitRuntime({ type: 'tool_finished', turnId, toolCall, result });
          },
        },
      );
      if (skillToolCalls.length > 0) {
        emitRuntime({ type: 'tool_batch_finished', turnId, toolCalls: skillToolCalls, results });
      }
      for (const result of results) {
        if (result.success) {
          emitRuntime({ type: 'notification', message: `[${matched_skill.name}] Step succeeded` });
        } else {
          emitRuntime({ type: 'notification', message: `[${matched_skill.name}] Step failed: ${result.output}` });
        }
      }
      const skillSummary = summarize_skill_results(matched_skill, results);
      session.add_message({
        role: 'assistant',
        content: skillSummary,
      });
      emitRuntime({ type: 'assistant_message', turnId, content: skillSummary });
      try {
        await maybeWriteMemory(trimmed, session, provider, memoryIndexStore, memoryTopicStore);
      } catch {
        // best-effort memory write
      }
      emitRuntime({ type: 'turn_completed', turnId, content: skillSummary });
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
      isDebug, runtimeSink, turnId, runtimeMetadata, memorySystemMessages,
    );
    try {
      await maybeWriteMemory(trimmed, session, provider, memoryIndexStore, memoryTopicStore);
    } catch {
      // best-effort memory write
    }
    void maybe_schedule_learning(turnTaskType, trimmed);
  }

  async function handle_learning_command(input: string, turnId: string): Promise<boolean> {
    if (!input.startsWith('/skill')) return false;
    const parts = input.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return false;
    const sub = parts[1];

    if (sub === 'review') {
      const drafts = skill_store.list_drafts();
      if (drafts.length === 0) {
        emitRuntime({ type: 'turn_completed', turnId, content: 'No draft skills pending review.' });
      } else {
        const lines = drafts.map((d) => `- ${d.id}: ${d.name} [${d.task_type}]`);
        emitRuntime({ type: 'turn_completed', turnId, content: ['Draft skills pending review:', ...lines].join('\n') });
      }
      return true;
    }

    if ((sub === 'approve' || sub === 'reject') && parts.length >= 3) {
      const id = parts[2];
      if (sub === 'approve') {
        const approved = await skill_store.approve_draft(id);
        if (!approved) {
          emitRuntime({ type: 'turn_completed', turnId, content: `Draft "${id}" not found.` });
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
        const aliases = build_skill_slash_aliases(approved).join(', ');
        emitRuntime({ type: 'notification', message: `Skill loaded: ${approved.name}${aliases ? ` (${aliases})` : ''}` });
        emitRuntime({ type: 'turn_completed', turnId, content: `Draft approved and published: ${approved.name}` });
        return true;
      }
      const rejected = await skill_store.reject_draft(id);
      emitRuntime({ type: 'turn_completed', turnId, content: rejected ? `Draft rejected: ${id}` : `Draft "${id}" not found.` });
      return true;
    }

    return false;
  }

  async function maybe_schedule_learning(taskType: string, userInput: string): Promise<void> {
    if (!learningWorker) return;
    const result = await learningWorker.onTurnCompleted(taskType, userInput);
    if (result.triggered && result.draftName) {
      emitRuntime({ type: 'notification', message: `Draft skill generated: ${result.draftName}` });
    }
    if (!reminderEnabled || reminderShown >= reminderMaxPerSession) return;
    const drafts = typeof skill_store.list_drafts === 'function' ? skill_store.list_drafts() : [];
    if (drafts.length > 0) {
      reminderShown++;
      emitRuntime({ type: 'notification', message: `[Learning] ${drafts.length} draft(s) pending review` });
    }
  }

  return {
    handle_user_input,
    clear_conversation: () => {
      session.clear();
    },
    list_slash_commands: () => build_runtime_skill_commands(),
    list_draft_skills: () => list_runtime_drafts(),
    get_skill_load_message: () => build_skill_load_message(skill_store.getManifest()),
  };
}

/**
 * Run the REPL loop.
 *
 * @param options REPL configuration options
 * @returns RunReplResult with handle_user_input (for testing) and start() to begin
 */
export async function run_repl(options: ReplOptions): Promise<RunReplResult> {
  const {
    working_dir,
    readline_interface: customRl,
    on_exit,
    events = {},
    provider,
    config,
    app_config,
    slash_handler,
    logLevel,
    agentId,
    agentRole,
  } = options;

const runtime = createRuntimeSinkFromAgentEvents(events);

  const agentRuntime = await create_agent_runtime({
    working_dir,
    provider,
    config,
    app_config,
    slash_handler,
    runtime,
    logLevel,
    agentId,
    agentRole,
  });

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
  // Main loop: strictly input-driven
  // ------------------------------------------------------------

  let running = true;
  /** 正在执行中的 turn，串行化防止并发导致 session 状态错乱 */
  let turnPromise: Promise<void> = Promise.resolve();

  async function main_loop(): Promise<never> {
    const isDebug = logLevel === 'debug';
    if (isDebug) {
      runtime.emit(createRuntimeEvent({ type: 'debug', message: 'main_loop started' }, {
        agentId: agentId ?? 'main',
        agentRole: agentRole ?? 'main',
      }));
    }

    if (!rl) {
      if (!process.stdin.isTTY) {
        runtime.emit(createRuntimeEvent({ type: 'error', message: 'REPL requires an interactive terminal (TTY).' }, {
          agentId: agentId ?? 'main',
          agentRole: agentRole ?? 'main',
        }));
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

    runtime.emit(createRuntimeEvent({ type: 'notification', message: 'REPL ready. Type /help for commands.' }, {
      agentId: agentId ?? 'main',
      agentRole: agentRole ?? 'main',
    }));

    while (running) {
      try {
        const input_value = await make_rl_promise();
        turnPromise = turnPromise.then(() => agentRuntime.handle_user_input(input_value));
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
    handle_user_input: agentRuntime.handle_user_input,
    clear_conversation: agentRuntime.clear_conversation,
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
  runtime: RuntimeSink,
  turnId: string,
  runtimeMetadata: { agentId: string; agentRole?: RuntimeAgentRole },
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
  const emitRuntime = (event: RuntimeEventInput) => {
    runtime.emit(createRuntimeEvent(event, runtimeMetadata));
  };

  // Tool execution loop
  while (true) {
    round++;
    if (round > MAX_TOOL_ROUNDS) {
      const msg = `Tool loop exceeded max rounds (${MAX_TOOL_ROUNDS})`;
      emitRuntime({ type: 'error', message: msg });
      session.add_message({ role: 'assistant', content: `Error: ${msg}` });
      emitRuntime({ type: 'turn_completed', turnId, content: `Error: ${msg}` });
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
        emitRuntime({ type: 'debug', message: `ctx.messages count: ${ctx.messages.length}` });
        for (const m of ctx.messages) {
          emitRuntime({ type: 'debug', message: `msg role=${m.role} content_len=${m.content.length}` });
        }
        emitRuntime({ type: 'debug', message: 'calling chat_stream with retry support...' });
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
            emitRuntime({ type: 'debug', message: 'Stream timeout after 60s, forcing close...' });
            resolve({ timedOut: true });
          }, STREAM_TIMEOUT_MS);
        });
        const nextPromise = retryableGen.next();

        const raceResult = await Promise.race([nextPromise, timeoutPromise]);
        clearTimeout(timeoutId!);

        if ('timedOut' in raceResult) {
          const msg = 'Stream timeout (60s) — server did not respond';
          emitRuntime({ type: 'error', message: msg });
          session.add_message({ role: 'assistant', content: `Error: ${msg}` });
          emitRuntime({ type: 'turn_completed', turnId, content: `Error: ${msg}` });
          return;
        }

        result = raceResult;
        if (result.done) {
          llm_response = result.value;
          break;
        }

        const chunk = result.value;
        ctx.appendAssistantChunk(chunk);
        emitRuntime({ type: 'assistant_chunk', turnId, chunk });
      }
      emitRuntime({ type: 'assistant_chunk', turnId, chunk: '\n' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emitRuntime({ type: 'error', message: `LLM Error: ${msg}` });
      session.add_message({ role: 'assistant', content: `Error: ${msg}` });
      emitRuntime({ type: 'turn_completed', turnId, content: `Error: ${msg}` });
      return;
    }

    // Guard: stream may have ended silently (e.g. SDK swallowed an HTTP error).
    // If llm_response is null/undefined, treat as error.
    if (!llm_response) {
      const msg = 'LLM stream returned no response (possible server error)';
      emitRuntime({ type: 'error', message: msg });
      session.add_message({ role: 'assistant', content: `Error: ${msg}` });
      emitRuntime({ type: 'turn_completed', turnId, content: `Error: ${msg}` });
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
        emitRuntime({ type: 'debug', message: `Response auto-continued (truncation recovery): +${assistantContent.length - llm_response.content.length} chars` });
      }
    } catch (err) {
      if (isDebug) {
        emitRuntime({ type: 'debug', message: `Truncation recovery failed: ${err instanceof Error ? err.message : String(err)}` });
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
      emitRuntime({ type: 'assistant_message', turnId, content: finalContent });
      emitRuntime({ type: 'turn_completed', turnId, content: finalContent });
      break;
    }

    // Persist assistant tool-call turn so next LLM call has a complete protocol transcript.
    session.add_message({
      role: 'assistant',
      content: finalContent,
      tool_calls: toolCalls,
    });
    emitRuntime({ type: 'assistant_message', turnId, content: finalContent, toolCalls });

    // Execute tool calls
    const approvalRequestHandler = async (request: import('../foundation/types.js').ApprovalRequest) => {
      emitRuntime({ type: 'approval_requested', turnId, request });
      const decision = runtime.requestApproval
        ? await runtime.requestApproval(request)
        : await approval_hook.wait_for_decision(request.id);
      emitRuntime({ type: 'approval_resolved', turnId, requestId: request.id, decision: decision.decision });
      return decision;
    };
    const results = await execute_tool_calls_parallel(
      toolCalls,
      tool_context,
      approval_hook,
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
      emitRuntime({ type: 'error', message: msg });
      session.add_message({ role: 'assistant', content: `Error: ${msg}` });
      emitRuntime({ type: 'turn_completed', turnId, content: `Error: ${msg}` });
      return;
    }
    emitRuntime({ type: 'tool_batch_finished', turnId, toolCalls, results });

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
        emitRuntime({ type: 'debug', message: `Proactive compaction: fill rate ${diagnostics.fillPercentage}` });
      }
      await session.compact();
    }

    // Rebuild context for next LLM call (includes tool results from session)
    ctx = build_llm_context(session, task_type, null, skill_reg, extra_system_messages);
  }
}
