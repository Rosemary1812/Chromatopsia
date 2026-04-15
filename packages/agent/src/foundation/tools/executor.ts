import path from 'node:path';
import type {
  ApprovalRequest,
  ApprovalResponse,
  ToolCall,
  ToolResult,
  ToolContext,
} from '../types.js';
import { registry } from './registry.js';
import { PATH_TRAVERSAL_PATTERNS } from './denied-patterns.js';
// Re-export for tests — DENIED_PATTERNS is the legacy name used in test imports
export { PATH_TRAVERSAL_PATTERNS as DENIED_PATTERNS } from './denied-patterns.js';
import { z } from 'zod';
import type { ApprovalHook } from '../../hooks/approval.js';

export type ApprovalRequestHandler = (
  request: ApprovalRequest,
) => Promise<ApprovalResponse>;

export interface ToolExecutionObserver {
  onToolStart?: (toolCall: ToolCall) => void;
  onToolEnd?: (toolCall: ToolCall, result: ToolResult) => void;
}

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
  for (const pattern of PATH_TRAVERSAL_PATTERNS) {
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
  approvalHook?: ApprovalHook,
  approvalRequestHandler?: ApprovalRequestHandler,
  observer?: ToolExecutionObserver,
): Promise<ToolResult[]> {
  if (tool_calls.length === 0) {
    return [];
  }

  const safe: ToolCall[] = [];
  const guarded: Array<{ toolCall: ToolCall; request: ApprovalRequest }> = [];

  for (const tc of tool_calls) {
    if (approvalHook) {
      const request = approvalHook.request_approval(tc.name, tc.arguments, 'tool execution');
      if (request === null) {
        safe.push(tc);
      } else {
        guarded.push({ toolCall: tc, request });
      }
    } else {
      const def = registry.get(tc.name);
      if (!def || def.danger_level === 'safe') {
        safe.push(tc);
      } else {
        guarded.push({
          toolCall: tc,
          request: {
            id: tc.id,
            tool_name: tc.name,
            args: tc.arguments,
            context: 'tool execution',
            timestamp: Date.now(),
          },
        });
      }
    }
  }

  // safe tools: parallel
  const safePromises = safe.map(async (tc) => {
    observer?.onToolStart?.(tc);
    const result = await execute_tool(tc, context);
    observer?.onToolEnd?.(tc, result);
    return result;
  });
  const safeResults = await Promise.all(safePromises);

  // warning/dangerous: serial
  const guardedResults: ToolResult[] = [];
  for (const guardedItem of guarded) {
    const { toolCall: tc, request } = guardedItem;
    if (!approvalHook) {
      observer?.onToolStart?.(tc);
      const result = await execute_tool(tc, context);
      observer?.onToolEnd?.(tc, result);
      guardedResults.push(result);
      continue;
    }

    const decision = approvalRequestHandler
      ? await approvalRequestHandler(request)
      : await approvalHook.wait_for_decision(request.id);

    if (decision.decision === 'reject') {
      const rejectedResult = {
        tool_call_id: tc.id,
        output: `Approval rejected for ${tc.name}`,
        success: false,
      };
      guardedResults.push(rejectedResult);
    } else if (decision.decision === 'edit' && decision.modified_args) {
      const editedToolCall = { ...tc, arguments: decision.modified_args };
      observer?.onToolStart?.(editedToolCall);
      const result = await execute_tool(editedToolCall, context);
      observer?.onToolEnd?.(editedToolCall, result);
      guardedResults.push(result);
    } else {
      observer?.onToolStart?.(tc);
      const result = await execute_tool(tc, context);
      observer?.onToolEnd?.(tc, result);
      guardedResults.push(result);
    }
  }

  return [...safeResults, ...guardedResults];
}
