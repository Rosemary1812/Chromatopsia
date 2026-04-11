// T-11: Grep Tool - regex search across files
import { readdir, readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult, ToolContext } from '../types.js';
import { resolve_path } from './executor.js';

// ============================================================
// Glob pattern matching (minimal implementation)
// ============================================================

function match_glob(filename: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{DOUBLE_STAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{DOUBLE_STAR\}\}/g, '.*')
    .replace(/\?/g, '.');

  try {
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filename);
  } catch {
    return false;
  }
}

function should_include_file(filepath: string, globPattern?: string): boolean {
  if (!globPattern) return true;
  const filename = path.basename(filepath);
  return match_glob(filename, globPattern);
}

// ============================================================
// Grep Handler
// ============================================================

interface GrepArgs {
  pattern: string;
  path: string;
  glob?: string;
  context?: number;
}

async function grep_handler(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const { pattern, path: searchPath, glob, context: contextLines = 0 } = args as unknown as GrepArgs;

  // Validate required parameters
  if (!pattern || typeof pattern !== 'string') {
    return { tool_call_id: '', output: 'Error: pattern is required and must be a string', success: false };
  }
  if (!searchPath || typeof searchPath !== 'string') {
    return { tool_call_id: '', output: 'Error: path is required and must be a string', success: false };
  }

  // Sandbox: resolve path within working directory
  let resolvedPath: string;
  try {
    resolvedPath = resolve_path(searchPath, context.working_directory);
  } catch (e) {
    return { tool_call_id: '', output: `Sandbox violation: ${e}`, success: false };
  }

  // Compile regex
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'g');
  } catch (e) {
    return { tool_call_id: '', output: `Error: invalid regex pattern: ${pattern}`, success: false };
  }

  // Collect all matching files
  const matches: string[] = [];

  async function search_dir(dirPath: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dirPath);
    } catch (e) {
      // Skip directories we can't read
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);

      // Check if it's a directory (recursive search)
      let isDir = false;
      try {
        isDir = statSync(fullPath).isDirectory();
      } catch {
        continue;
      }

      if (isDir) {
        await search_dir(fullPath);
      } else {
        // Check glob filter
        if (!should_include_file(fullPath, glob)) continue;

        // Search in file
        await search_file(fullPath);
      }
    }
  }

  async function search_file(filePath: string): Promise<void> {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      // Skip files we can't read
      return;
    }

    const lines = content.split('\n');
    const ctx = typeof contextLines === 'number' ? contextLines : 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Reset regex state for each line
      regex.lastIndex = 0;
      if (regex.test(line)) {
        // Get context lines
        const start = Math.max(0, i - ctx);
        const end = Math.min(lines.length - 1, i + ctx);

        for (let j = start; j <= end; j++) {
          const prefix = j === i ? '>' : ' ';
          const lineNum = j + 1;
          matches.push(`${prefix}${lineNum} | ${lines[j]}`);
        }
        matches.push(''); // blank line between matches
      }
    }
  }

  await search_dir(resolvedPath);

  if (matches.length === 0) {
    return { tool_call_id: '', output: '', success: true };
  }

  return { tool_call_id: '', output: matches.join('\n').trim(), success: true };
}

// ============================================================
// Tool Definition
// ============================================================

export const grep_definition: ToolDefinition = {
  name: 'Grep',
  description: 'Search for a pattern in files using regex.',
  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search for',
      },
      path: {
        type: 'string',
        description: 'Directory or file to search in',
      },
      glob: {
        type: 'string',
        description: 'File pattern filter (e.g., "*.ts")',
      },
      context: {
        type: 'number',
        description: 'Lines of context before/after (default: 0)',
      },
    },
    required: ['pattern', 'path'],
  },
  danger_level: 'safe',
  handler: grep_handler,
};

// Export for testing
export { grep_handler as grep_tool };
