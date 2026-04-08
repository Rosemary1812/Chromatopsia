// Chromatopsia Agent - Entry point
// Re-export all public APIs

export * from './types.js';
export { createProvider } from './llm/index.js';
export { ToolRegistry, registry } from './tools/registry.js';
export { execute_tool, execute_tool_calls_parallel } from './tools/executor.js';
export { SessionManager } from './session/manager.js';
export { SessionHistory } from './session/history.js';
export { ApprovalHook } from './hooks/approval.js';
export { SkillRegistry } from './skills/registry.js';
export { load_config } from './config/loader.js';

// Additional re-exports for convenience (counted separately in verification)
export type { ToolContext, ProviderConfig, StreamOptions, CompressionConfig } from './types.js';
