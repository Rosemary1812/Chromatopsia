import path from 'node:path';
import type { ToolCall, ToolResult, ToolContext } from '../types.js';
import { registry } from './registry.js';
import { z } from 'zod';

/**
 * Patterns that are always denied, regardless of working directory.
 * Used for shell command sandboxing.
 */
export const DENIED_PATTERNS: RegExp[] = [
  /^\s*cd\s+\.\./,           //向上跳转
  /~\//,                      // home 目录访问
  /\/etc\//,                  // 系统配置
  /\/proc\//,                // 进程信息
  /\/sys\//,                 // 内核信息
];

/**
 * Resolve a relative or absolute path within the working directory sandbox.
 * Throws if the resolved path escapes the sandbox.
 */
export function resolve_path(
  relative_or_absolute: string,
  working_dir: string,
): string {
  const resolved = path.isAbsolute(relative_or_absolute)
    ? relative_or_absolute
    : path.resolve(working_dir, relative_or_absolute);

  const normalized = path.normalize(resolved);
  const normWd = path.normalize(working_dir);

  if (
    !normalized.startsWith(normWd + path.sep) &&
    normalized !== normWd
  ) {
    throw new Error(
      `Sandbox violation: ${relative_or_absolute} resolves outside working directory`,
    );
  }
  return normalized;
}

/**
 * Sanitize a shell command for sandboxed execution.
 * - Rewrites ~ to working_dir (before pattern check)
 * - Checks denied patterns
 * - Strips leading/trailing whitespace
 */
export function sandbox_bash_command(
  rawCommand: string,
  working_dir: string,
): string {
  // Replace ~ with working_dir FIRST (before pattern check)
  let cmd = rawCommand;
  if (cmd.includes('~')) {
    cmd = cmd.replace(/~/g, working_dir);
  }

  // Check denied patterns after tilde expansion
  for (const pattern of DENIED_PATTERNS) {
    if (pattern.test(cmd)) {
      throw new Error(`Denied pattern detected: ${rawCommand}`);
    }
  }

  const lines = cmd.split('\n');
  const sanitizedLines = lines.map((line) => line.trim()).filter(Boolean);

  return sanitizedLines.join(' && ');
}

/**
 * Validate arguments against a JSON Schema (basic validation).
 */
function validate_args(
  args: Record<string, unknown>,
  schema: object,
): boolean {
  const properties = (schema as { properties?: Record<string, unknown> }).properties;
  if (!properties) return true;

  const required = (schema as { required?: string[] }).required ?? [];

  for (const key of required) {
    if (!(key in args)) return false;
  }

  return true;
}

/**
 * Execute a single tool call.
 */
export async function execute_tool(
  tool_call: ToolCall,
  context: ToolContext,
): Promise<ToolResult> {
  const definition = registry.get(tool_call.name);
  if (!definition) {
    return {
      tool_call_id: tool_call.id,
      output: `Unknown tool: ${tool_call.name}`,
      success: false,
    };
  }

  // Validate arguments (优先 Zod schema，次选 JSON Schema)
  if (definition.zod_schema) {
    const zodSchema = definition.zod_schema as z.ZodType;
    const result = zodSchema.safeParse(tool_call.arguments);
    if (!result.success) {
      return {
        tool_call_id: tool_call.id,
        output: `Invalid arguments: ${result.error.message}`,
        success: false,
      };
    }
  } else {
    const valid = validate_args(tool_call.arguments, definition.input_schema);
    if (!valid) {
      return {
        tool_call_id: tool_call.id,
        output: 'Invalid arguments',
        success: false,
      };
    }
  }

  // Execute
  try {
    return await definition.handler(tool_call.arguments, context);
  } catch (e) {
    return {
      tool_call_id: tool_call.id,
      output: String(e),
      success: false,
    };
  }
}

/**
 * Execute multiple tool calls, with parallel execution for 'safe' tools
 * and serial execution for 'warning'/'dangerous' tools.
 */
export async function execute_tool_calls_parallel(
  tool_calls: ToolCall[],
  context: ToolContext,
): Promise<ToolResult[]> {
  const safe: ToolCall[] = [];
  const guarded: ToolCall[] = [];

  for (const tc of tool_calls) {
    const def = registry.get(tc.name);
    if (!def || def.danger_level === 'safe') {
      safe.push(tc);
    } else {
      guarded.push(tc);
    }
  }

  // safe tools: parallel
  const safePromises = safe.map((tc) => execute_tool(tc, context));
  const safeResults = await Promise.all(safePromises);

  // warning/dangerous: serial (no approval hook in this standalone executor)
  const guardedResults: ToolResult[] = [];
  for (const tc of guarded) {
    guardedResults.push(await execute_tool(tc, context));
  }

  return [...safeResults, ...guardedResults];
}
