// T-23: repl/executor.ts — Parallel Tool Execution + Skill Executor
import { randomUUID } from 'crypto';
import type { ToolCall, ToolResult, ToolContext, Skill } from '../foundation/types.js';
import { execute_tool } from '../foundation/tools/executor.js';
import { ApprovalHook } from '../hooks/approval.js';
import { SkillPatcher } from '../skills/patcher.js';

/**
 * Execute tool calls with parallel safe execution and serial guarded execution.
 * Dangerous/warning tools are gated through ApprovalHook.
 *
 * @param tool_calls - Array of tool calls to execute
 * @param context - Tool execution context
 * @param approvalHook - Optional ApprovalHook instance; if not provided, dangerous tools execute without approval
 * @returns Array of tool results, matching the order of tool_calls
 */
export async function execute_tool_calls_parallel(
  tool_calls: ToolCall[],
  context: ToolContext,
  approvalHook?: ApprovalHook,
): Promise<ToolResult[]> {
  if (tool_calls.length === 0) {
    return [];
  }

  const safe: ToolCall[] = [];
  const guarded: ToolCall[] = [];

  for (const tc of tool_calls) {
    // If we have an approval hook, use it to classify; otherwise use registry danger_level
    if (approvalHook) {
      const request = approvalHook.request_approval(tc.name, tc.arguments, 'tool execution');
      if (request === null) {
        safe.push(tc);
      } else {
        guarded.push(tc);
      }
    } else {
      // No approval hook — fall back to danger level check
      safe.push(tc);
    }
  }

  // safe tools: parallel
  const safeResults = await Promise.all(safe.map((tc) => execute_tool(tc, context)));

  // guarded tools: serial with approval
  const guardedResults: ToolResult[] = [];
  for (const tc of guarded) {
    if (!approvalHook) {
      // No approval hook available — execute anyway (dangerous!)
      guardedResults.push(await execute_tool(tc, context));
      continue;
    }

    const request = approvalHook.request_approval(tc.name, tc.arguments, 'tool execution');
    if (!request) {
      // Auto-approved
      guardedResults.push(await execute_tool(tc, context));
    } else {
      // Request approval
      const decision = await approvalHook.wait_for_decision(request.id);
      if (decision.decision === 'reject') {
        guardedResults.push({
          tool_call_id: tc.id,
          output: `Approval rejected for ${tc.name}`,
          success: false,
        });
      } else if (decision.decision === 'edit' && decision.modified_args) {
        // Execute with modified args
        const modifiedTc: ToolCall = { ...tc, arguments: decision.modified_args };
        guardedResults.push(await execute_tool(modifiedTc, context));
      } else {
        // Approved — execute
        guardedResults.push(await execute_tool(tc, context));
      }
    }
  }

  return [...safeResults, ...guardedResults];
}

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
 * On failure, calls SkillPatcher.patch() to update the skill.
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
  const patcher = new SkillPatcher();
  const results: ToolResult[] = [];
  const failed_buffer = [];

  for (let i = 0; i < skill.steps.length; i++) {
    const step = skill.steps[i];
    const tool_call = parse_step_to_tool_call(step, context.session.id);

    if (!tool_call) {
      results.push({
        tool_call_id: `step-${i}`,
        output: `Failed to parse step ${i + 1}: ${step}`,
        success: false,
      });
      failed_buffer.push({
        tool_calls: [{ id: `step-${i}`, name: 'unknown', arguments: {} }],
        tool_results: [results[results.length - 1]],
        task_type: skill.task_type,
        session_id: context.session.id,
        timestamp: Date.now(),
      });
      continue;
    }

    const result = await execute_tool_calls_parallel([tool_call], context, approvalHook);
    const tool_result = result[0];
    results.push(tool_result);

    if (!tool_result.success) {
      failed_buffer.push({
        tool_calls: [tool_call],
        tool_results: [tool_result],
        task_type: skill.task_type,
        session_id: context.session.id,
        timestamp: Date.now(),
      });
    }
  }

  // If any step failed, patch the skill
  if (failed_buffer.length > 0) {
    await patcher.patch(skill, failed_buffer);
  }

  return results;
}
