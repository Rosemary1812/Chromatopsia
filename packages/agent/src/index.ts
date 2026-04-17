// Chromatopsia Agent - Entry point
// Re-export all public APIs

export * from './foundation/types.js';
export { run_repl } from './repl/loop.js';
export { create_agent_runtime } from './repl/loop.js';
export type { ReplOptions, RunReplResult, AgentRuntimeOptions, AgentRuntimeResult } from './repl/loop.js';
export { createRuntimeEvent, createRuntimeSinkFromAgentEvents } from './repl/runtime.js';
export { createProvider } from './foundation/llm/index.js';
export { ToolRegistry, registry } from './foundation/tools/registry.js';
export { register_all_tools } from './foundation/tools/index.js';
export { execute_tool } from './foundation/tools/executor.js';
export { execute_tool_calls_parallel } from './repl/executor.js';
export { SessionManager } from './session/manager.js';
export { SessionHistory } from './session/history.js';
export { ApprovalHook } from './hooks/approval.js';
export { SkillRegistry } from './skills/registry.js';
export { MemoryIndexStore } from './memory/index-store.js';
export { MemoryTopicStore } from './memory/topic-store.js';
export { buildMemoryInjection } from './memory/injector.js';
export { maybeWriteMemory } from './memory/writer.js';
export { decideMemoryWrite, buildMemoryDecisionPrompt } from './memory/decider.js';
export { TurnEventStore } from './learning/turn-event-store.js';
export { LearningWorker } from './learning/worker.js';
export { load_config } from './config/loader.js';
export { resolveProjectRoot, resolveStoragePaths } from './storage/paths.js';

// Additional re-exports for convenience (counted separately in verification)
export type { ToolContext, ProviderConfig, StreamOptions, CompressionConfig } from './foundation/types.js';
