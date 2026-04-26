import type { ProviderConfig, ProviderType, RuntimeEvent, RuntimeSink } from '../foundation/types.js';
import { createProvider, normalizeProviderType, resolveProviderConfig } from '../foundation/llm/index.js';
import { load_config } from '../config/loader.js';
import { SessionManager } from '../session/manager.js';
import { SkillRegistry } from '../skills/registry.js';
import { SkillStore } from '../skills/store.js';
import { ApprovalHook } from '../hooks/approval.js';
import { MemoryIndexStore } from '../memory/index-store.js';
import { MemoryTopicStore } from '../memory/topic-store.js';
import { TurnEventStore } from '../learning/turn-event-store.js';
import { LearningWorker } from '../learning/worker.js';
import { TraceLogger } from './trace-logger.js';
import { register_all_tools, register_skill_tool } from '../foundation/tools/index.js';
import { createRuntimeEvent } from './runtime.js';
import type { RuntimeEventInput } from './runtime.js';
import { createLearningTurnHook } from './turn-hooks.js';
import { buildRuntimeSkillCommands, build_skill_load_message, createHandleUserInputTurn, createLearningCommandHandler, listRuntimeDrafts } from './turn-router.js';
import { resolveStoragePaths } from '../storage/paths.js';
import { handle_slash_command as default_slash_handler } from './slash.js';
import type { AgentRuntimeOptions, AgentRuntimeResult } from './loop-types.js';

export async function create_agent_runtime_impl(
  options: AgentRuntimeOptions,
): Promise<AgentRuntimeResult> {
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
    maxToolRounds,
  } = options;

  const loadedAppConfig = app_config ?? (config_path ? await load_config(config_path) : undefined);
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
  const runtimeSink: RuntimeSink = runtime ?? { emit: () => {} };
  const runtimeMetadata = { agentId, agentRole };
  let trace_logger: TraceLogger | null = null;
  const handleRuntimeEvent = (runtimeEvent: RuntimeEvent) => {
    if (trace_logger) {
      switch (runtimeEvent.type) {
        case 'turn_started':
          trace_logger.startTurn(runtimeEvent.turnId, runtimeEvent.text, provider.get_model());
          break;
        case 'tool_started':
          trace_logger.recordToolStart(runtimeEvent.turnId, runtimeEvent.toolCall);
          break;
        case 'tool_finished':
          trace_logger.recordToolEnd(runtimeEvent.turnId, runtimeEvent.toolCall.id, runtimeEvent.result);
          break;
        case 'turn_completed':
          void trace_logger.completeTurn(
            runtimeEvent.turnId,
            runtimeEvent.content,
            runtimeEvent.finishReason ?? 'stop',
            runtimeEvent.tokenUsage,
          );
          break;
        case 'error':
          if ('turnId' in runtimeEvent && typeof runtimeEvent.turnId === 'string') {
            void trace_logger.recordError(runtimeEvent.turnId, runtimeEvent.message);
          }
          break;
        default:
          break;
      }
    }

    runtimeSink.emit(runtimeEvent);
  };
  const emitRuntime = (event: RuntimeEventInput) => {
    handleRuntimeEvent(createRuntimeEvent(event, runtimeMetadata));
  };

  register_all_tools();

  const provider = createProvider(resolvedProvider, resolvedConfig);
  const storagePaths = resolveStoragePaths({
    workingDir: working_dir,
    appConfig: loadedAppConfig,
    configPath: config_path,
  });
  const session_manager = new SessionManager(storagePaths.sessionsDir, provider);
  
  // P0-1: 会话恢复 — 尝试恢复现有会话而不是总是创建新的
  let session;
  let sessionRecovered = false;
  
  try {
    const recoveryResult = await session_manager.recover_or_prompt(working_dir);
    
    if ('recovered' in recoveryResult && typeof recoveryResult.recovered === 'boolean') {
      // Case 1: 返回了一个 session（无会话时创建新，或单会话时恢复）
      session = recoveryResult.session;
      sessionRecovered = recoveryResult.recovered;
      if (isDebug) {
        emitRuntime({
          type: 'debug',
          message: sessionRecovered 
            ? `Session recovered: ${session.id}` 
            : `New session created: ${session.id}`
        });
      }
    } else if ('candidates' in recoveryResult) {
      // Case 2: 多个候选会话
      // 暂时创建新会话，CLI 层后续可支持选择
      session = session_manager.create_session(working_dir);
      sessionRecovered = false;
      emitRuntime({
        type: 'notification',
        message: `Multiple session candidates found for ${working_dir}. Starting new session. Use 'session list' to view.`
      });
    } else {
      // Fallback：直接创建
      session = session_manager.create_session(working_dir);
      sessionRecovered = false;
    }
  } catch (err) {
    // 恢复失败，降级到新会话
    session = session_manager.create_session(working_dir);
    sessionRecovered = false;
    if (isDebug) {
      emitRuntime({
        type: 'debug',
        message: `Session recovery failed, created new session: ${session.id}`
      });
    }
  }

  // P0-4: 安全审计日志 — 初始化 ApprovalLogger
  const approval_hook = new ApprovalHook({
    auto_approve_safe: loadedAppConfig?.approval?.auto_approve_safe ?? true,
    timeout_ms: (loadedAppConfig?.approval?.timeout_seconds ?? 300) * 1000,
    logsDir: storagePaths.logsDir,  // 传入 logsDir
  });

  // P0-2: Trace 持久化 — 初始化 TraceLogger
  trace_logger = new TraceLogger(storagePaths.logsDir, session.id);
  await trace_logger.init();

  const skill_reg = new SkillRegistry();
  const skill_store = new SkillStore({
    indexPath: storagePaths.skillsIndexPath,
    runtimeSkillsRoot: storagePaths.skillsDir,
    builtinSkillsRoots: storagePaths.builtinSkillsRoots,
    enableBuiltin: true,
    cwd: storagePaths.projectRoot,
  });
  const memoryIndexStore = new MemoryIndexStore(storagePaths.memoryDir);
  const memoryTopicStore = new MemoryTopicStore(storagePaths.memoryDir);
  const turnEventStore = new TurnEventStore({ baseDir: storagePaths.learningDir });

  await skill_store.load();
  register_skill_tool(skill_store);
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
  const learningWorker = learningEnabled
    ? new LearningWorker({
        provider,
        session,
        skillStore: skill_store,
        skillRegistry: skill_reg,
        eventStore: turnEventStore,
      }, learningBatchTurns, learningMinConfidence)
    : null;
  const triggerLearningAfterTurn = createLearningTurnHook({
    learningWorker,
    skillStore: skill_store,
    reminderEnabled,
    reminderMaxPerSession,
    emitRuntime,
  });

  const tool_context = {
    session,
    working_directory: working_dir,
  };
  const instrumentedRuntime: RuntimeSink = {
    emit: handleRuntimeEvent,
    requestApproval: runtimeSink.requestApproval,
  };

  const handleLearningCommand = createLearningCommandHandler({
    skillStore: skill_store,
    skillRegistry: skill_reg,
    emitRuntime,
  });
  const handle_user_input = createHandleUserInputTurn({
    session,
    provider,
    skillRegistry: skill_reg,
    skillStore: skill_store,
    approvalHook: approval_hook,
    toolContext: tool_context,
    isDebug,
    runtime: instrumentedRuntime,
    runtimeMetadata,
    maxToolRounds,
    emitRuntime,
    slashHandler: slash_handler,
    handleLearningCommand,
    memoryIndexStore,
    memoryTopicStore,
    triggerLearningAfterTurn,
  });

  return {
    handle_user_input,
    clear_conversation: () => {
      session.clear();
    },
    list_slash_commands: () => buildRuntimeSkillCommands(skill_store),
    list_draft_skills: () => listRuntimeDrafts(skill_store),
    get_skill_load_message: () => build_skill_load_message(skill_store.getManifest()),
    sessionId: session.id,  // 新增
    sessionRecovered,  // 新增
    traceLogger: trace_logger,  // 新增：P0-2
  };
}
