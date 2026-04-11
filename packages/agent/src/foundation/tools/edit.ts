// T-10: Edit Tool - targeted file content replacement
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { ToolDefinition, ToolResult, ToolContext } from '../types.js';
import { resolve_path } from './executor.js';

// ============================================================
// Handler
// ============================================================

interface EditArgs {
  file_path: string;
  old_string: string;
  new_string: string;
}

async function edit_handler(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const { file_path, old_string, new_string } = args as unknown as EditArgs;

  // Validate required parameters
  if (!file_path || typeof file_path !== 'string') {
    return { tool_call_id: '', output: 'Error: file_path is required', success: false };
  }
  if (typeof old_string !== 'string') {
    return { tool_call_id: '', output: 'Error: old_string is required', success: false };
  }
  if (typeof new_string !== 'string') {
    return { tool_call_id: '', output: 'Error: new_string is required', success: false };
  }

  // Sandbox: resolve path within working directory
  let resolvedPath: string;
  try {
    resolvedPath = resolve_path(file_path, context.working_directory);
  } catch (e) {
    return { tool_call_id: '', output: `Sandbox violation: ${e}`, success: false };
  }

  // Check file exists
  if (!existsSync(resolvedPath)) {
    return { tool_call_id: '', output: `Error: file not found: ${file_path}`, success: false };
  }

  // Read file content
  let content: string;
  try {
    content = await readFile(resolvedPath, 'utf-8');
  } catch (e) {
    return { tool_call_id: '', output: `Error reading file: ${e}`, success: false };
  }

  // Find old_string
  const index = content.indexOf(old_string);
  if (index === -1) {
    return {
      tool_call_id: '',
      output: `Error: old_string not found in file: ${old_string}`,
      success: false,
    };
  }

  // Replace first occurrence only
  const newContent = content.slice(0, index) + new_string + content.slice(index + old_string.length);

  // Write back
  try {
    await writeFile(resolvedPath, newContent, 'utf-8');
  } catch (e) {
    return { tool_call_id: '', output: `Error writing file: ${e}`, success: false };
  }

  return {
    tool_call_id: '',
    output: `Successfully replaced "${old_string}" with "${new_string}"`,
    success: true,
  };
}

// ============================================================
// Tool Definition
// ============================================================

export const edit_definition: ToolDefinition = {
  name: 'Edit',
  description:
    'Make a targeted edit to a specific file. Use for changing, adding, or removing code.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: { type: 'string' },
      old_string: {
        type: 'string',
        description: 'Exact text to replace (must be unique in file)',
      },
      new_string: { type: 'string', description: 'Replacement text' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  danger_level: 'warning',
  handler: edit_handler,
};
