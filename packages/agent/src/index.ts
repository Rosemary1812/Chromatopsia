// Chromatopsia Agent - Entry point
// Re-export all public APIs

export * from './foundation/types.js';
export { run_repl } from './repl/loop.js';
export type { ReplOptions, RunReplResult } from './repl/loop.js';
export { createProvider } from './foundation/llm/index.js';
export { ToolRegistry, registry } from './foundation/tools/registry.js';
export { register_all_tools } from './foundation/tools/index.js';
export { execute_tool, execute_tool_calls_parallel } from './foundation/tools/executor.js';
export { SessionManager } from './agent/session/manager.js';
export { SessionHistory } from './agent/session/history.js';
export { ApprovalHook } from './hooks/approval.js';
export { SkillRegistry } from './skills/registry.js';
export { load_config } from './config/loader.js';

// Additional re-exports for convenience (counted separately in verification)
export type { ToolContext, ProviderConfig, StreamOptions, CompressionConfig } from './foundation/types.js';
