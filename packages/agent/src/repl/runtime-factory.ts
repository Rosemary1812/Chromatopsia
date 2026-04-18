import type { ProviderConfig, ProviderType, RuntimeSink } from '../foundation/types.js';
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
import { register_all_tools } from '../foundation/tools/index.js';
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
  const emitRuntime = (event: RuntimeEventInput) => {
    runtimeSink.emit(createRuntimeEvent(event, runtimeMetadata));
  };

  register_all_tools();

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
    runtime: runtimeSink,
    runtimeMetadata,
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
  };
}
