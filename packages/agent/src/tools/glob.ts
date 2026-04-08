// T-11: Glob Tool - file pattern matching
import { readdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition, ToolResult, ToolContext } from '../types.js';
import { resolve_path } from './executor.js';

// ============================================================
// Glob Pattern Matching
// ============================================================

function parse_glob_pattern(pattern: string): { parts: string[]; recursive: boolean } {
  const parts = pattern.split('/').filter(Boolean);
  const recursive = pattern.includes('**');
  return { parts, recursive };
}

function matches_pattern(filename: string, pattern: string): boolean {
  // Simple glob matching for single segment patterns
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{DOUBLE_STAR}}')
    .replace(/\*/g, '[^/]*')
    .replaceAll('{{DOUBLE_STAR}}', '.*')
    .replace(/\?/g, '.');

  try {
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filename);
  } catch {
    return false;
  }
}

async function glob_recursive(
  dirPath: string,
  patternParts: string[],
  depth: number,
  maxDepth: number,
  results: string[],
): Promise<void> {
  if (depth >= patternParts.length) {
    // Matched all pattern parts, add the path
    results.push(dirPath);
    return;
  }

  const currentPattern = patternParts[depth];
  const isLastSegment = depth === patternParts.length - 1;

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);

    let isDir = false;
    try {
      isDir = statSync(fullPath).isDirectory();
    } catch {
      continue;
    }

    if (!matches_pattern(entry, currentPattern)) continue;

    if (isLastSegment) {
      results.push(fullPath);
    } else if (isDir) {
      if (currentPattern === '**') {
        // ** matches:
        // 1. Recurse with next pattern part (directory contents matched by **)
        await glob_recursive(fullPath, patternParts, depth + 1, maxDepth, results);
        // 2. Recurse with same pattern part (subdirs matched by **)
        await glob_recursive(fullPath, patternParts, depth, maxDepth, results);
      } else {
        await glob_recursive(fullPath, patternParts, depth + 1, maxDepth, results);
      }
    } else if (currentPattern === '**') {
      // ** matched a file - try remaining pattern against filename
      const remainingPattern = patternParts.slice(depth + 1);
      if (remainingPattern.length === 1) {
        // Last remaining segment - check if filename matches
        if (matches_pattern(entry, remainingPattern[0])) {
          results.push(fullPath);
        }
      } else if (remainingPattern.length > 1) {
        // Multiple remaining segments - can't match a file
      }
    }
  }
}

// ============================================================
// Glob Handler
// ============================================================

interface GlobArgs {
  pattern: string;
  path?: string;
}

async function glob_handler(
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolResult> {
  const { pattern, path: basePath = context.working_directory } = args as unknown as GlobArgs;

  // Validate required parameters
  if (!pattern || typeof pattern !== 'string') {
    return { tool_call_id: '', output: 'Error: pattern is required and must be a string', success: false };
  }

  // Sandbox: resolve path within working directory
  let resolvedPath: string;
  try {
    resolvedPath = resolve_path(basePath, context.working_directory);
  } catch (e) {
    return { tool_call_id: '', output: `Sandbox violation: ${e}`, success: false };
  }

  const { parts, recursive } = parse_glob_pattern(pattern);
  const results: string[] = [];

  // Determine max depth
  const maxDepth = recursive ? parts.length : parts.length;

  await glob_recursive(resolvedPath, parts, 0, maxDepth, results);

  // Sort results for consistent output
  results.sort();

  return {
    tool_call_id: '',
    output: results.join('\n'),
    success: true,
  };
}

// ============================================================
// Tool Definition
// ============================================================

export const glob_definition: ToolDefinition = {
  name: 'Glob',
  description:
    'Find files matching a glob pattern. Also serves as list_files for directory listing (use pattern "*" for current dir, "**/*" for recursive).',
  input_schema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern (e.g., "**/*.ts" for recursive, "*" for current dir only)',
      },
      path: {
        type: 'string',
        description: 'Base directory (default: project root)',
      },
    },
    required: ['pattern'],
  },
  danger_level: 'safe',
  handler: glob_handler,
};

// Export for testing
export { glob_handler as glob_tool };
