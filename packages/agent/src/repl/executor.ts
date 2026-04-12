// T-23: repl/executor.ts — Parallel Tool Execution + Skill Executor
import { randomUUID } from 'crypto';
import type { ToolCall, ToolResult, ToolContext, Skill } from '../foundation/types.js';
import { execute_tool_calls_parallel } from '../foundation/tools/executor.js';
import { ApprovalHook } from '../hooks/approval.js';
export { execute_tool_calls_parallel } from '../foundation/tools/executor.js';

/**
 * Parse a step string into a ToolCall.
 * Format: "tool_name key1=value1 key2=value2 ..."
 * Values can be quoted strings: key="multi word value"
 * Values can be arrays: key=[item1,item2]
 *
 * @param step - Step string from skill.steps
 * @param session_id - Session ID for tool call ID
 * @returns ToolCall or null if parsing fails
 */
export function parse_step_to_tool_call(step: string, session_id: string): ToolCall | null {
  if (!step || typeof step !== 'string') {
    return null;
  }

  const trimmed = step.trim();
  if (!trimmed) {
    return null;
  }

  // Match: tool_name (possibly followed by key=value pairs)
  const match = trimmed.match(/^(\S+)(?:\s+(.+))?$/);
  if (!match) {
    return null;
  }

  const tool_name = match[1];
  const args_str = match[2] ?? '';

  const arguments_: Record<string, unknown> = {};

  if (args_str) {
    // Parse key=value pairs
    // Supports: key=value, key="quoted value", key=[item1,item2]
    const pairRegex = /(\w+)=(?:"([^"]*)"|\[([^\]]*)\]|(\S+(?:(?!\s*[\w-]+=)\s+\S+)*))/g;
    let pairMatch;
    while ((pairMatch = pairRegex.exec(args_str)) !== null) {
      const key = pairMatch[1];
      const quotedValue = pairMatch[2];
      const arrayValue = pairMatch[3];
      const plainValue = pairMatch[4];

      if (quotedValue !== undefined) {
        arguments_[key] = quotedValue;
      } else if (arrayValue !== undefined) {
        arguments_[key] = arrayValue.split(',').map((s) => s.trim());
      } else if (plainValue !== undefined) {
        // Try to parse as number or boolean
        if (plainValue === 'true') {
          arguments_[key] = true;
        } else if (plainValue === 'false') {
          arguments_[key] = false;
        } else if (/^\d+$/.test(plainValue)) {
          arguments_[key] = Number(plainValue);
        } else {
          arguments_[key] = plainValue;
        }
      }
    }
  }

  return {
    id: `skill-${session_id}-${randomUUID().slice(0, 8)}`,
    name: tool_name,
    arguments: arguments_,
  };
}

/**
 * Execute a skill by running each step as a tool call.
 *
 * @param skill - Skill to execute
 * @param context - Tool execution context
 * @param approvalHook - Optional ApprovalHook for dangerous tool approval
 * @returns Array of tool results from all steps
 */
export async function execute_skill(
  skill: Skill,
  context: ToolContext,
  approvalHook?: ApprovalHook,
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (let i = 0; i < skill.steps.length; i++) {
    const step = skill.steps[i];
    const tool_call = parse_step_to_tool_call(step, context.session.id);

    if (!tool_call) {
      results.push({
        tool_call_id: `step-${i}`,
        output: `Failed to parse step ${i + 1}: ${step}`,
        success: false,
      });
      continue;
    }

    const result = await execute_tool_calls_parallel([tool_call], context, approvalHook);
    const tool_result = result[0];
    results.push(tool_result);
  }

  return results;
}
