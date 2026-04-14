// T-09: Read Tool - file reading with sandbox
import { readFile } from 'node:fs/promises';
import type { ToolDefinition, ToolResult, ToolContext } from '../types.js';
import { resolve_path } from './executor.js';

// ============================================================
// Read Handler
// ============================================================

// ============================================================
// Read Handler
// ============================================================

interface ReadArgs {
  file_path: string;
  offset?: number;
  limit?: number;
}

async function read_handler(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const { file_path, offset = 0, limit = 500 } = args as unknown as ReadArgs;

  // Validate file_path
  if (!file_path || typeof file_path !== 'string') {
    return {
      tool_call_id: '',
      output: 'Error: file_path is required and must be a string',
      success: false,
    };
  }

  // Resolve and sandbox the path
  let resolvedPath: string;
  try {
    resolvedPath = resolve_path(file_path, context.working_directory);
  } catch (e) {
    return {
      tool_call_id: '',
      output: `Error: Sandbox violation - ${file_path} is outside working directory`,
      success: false,
    };
  }

  // Read the file
  let content: string;
  try {
    content = await readFile(resolvedPath, 'utf-8');
  } catch (e) {
    const msg = String(e);
    if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('no such file')) {
      return {
        tool_call_id: '',
        output: `Error: File not found: ${file_path}`,
        success: false,
      };
    }
    return {
      tool_call_id: '',
      output: `Error reading file: ${msg}`,
      success: false,
    };
  }

  // Split into lines and apply offset/limit
  const lines = content.split('\n');
  const start = Math.max(0, offset);
  const end = Math.min(lines.length, start + limit);
  const sliced = lines.slice(start, end);

  // Build output with line numbers
  const outputLines: string[] = [];
  for (let i = start; i < end; i++) {
    outputLines.push(`${i + 1} | ${sliced[i - start]}`);
  }

  return {
    tool_call_id: '',
    output: outputLines.join('\n'),
    success: true,
  };
}

// ============================================================
// Tool Definition
// ============================================================

export const read_definition: ToolDefinition = {
  name: 'Read',
  description: 'Read the contents of a file. Shows line numbers for reference.',
  input_schema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to the file to read (relative to working directory)',
      },
      offset: {
        type: 'number',
        description: 'Line number to start from (0-based, default: 0)',
      },
      limit: {
        type: 'number',
        description: 'Max lines to read (default: 500)',
      },
    },
    required: ['file_path'],
  },
  danger_level: 'safe',
  handler: read_handler,
};
