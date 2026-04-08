// Placeholder - to be implemented in Phase 2
import type { ToolCall, ToolResult, ToolContext } from '../types.js';

export async function execute_tool(
  _tool_call: ToolCall,
  _context: ToolContext,
): Promise<ToolResult> {
  throw new Error('Not implemented yet');
}

export async function execute_tool_calls_parallel(
  _tool_calls: ToolCall[],
  _context: ToolContext,
): Promise<ToolResult[]> {
  throw new Error('Not implemented yet');
}
