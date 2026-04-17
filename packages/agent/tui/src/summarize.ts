import type { ToolCall, ToolResult } from '@chromatopsia/agent';

function truncate(value: string, maxLength = 120): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function firstMeaningfulLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

export function summarizeToolResult(toolCall: ToolCall, result: ToolResult): string | undefined {
  if (!result.output) {
    return result.success ? `${toolCall.name} completed` : `${toolCall.name} failed`;
  }

  if (!result.success) {
    return truncate(result.output);
  }

  switch (toolCall.name) {
    case 'Read':
    case 'read':
      return 'Read completed';
    case 'Edit':
    case 'edit':
      return 'Edit applied';
    case 'run_shell':
    case 'bash':
      return truncate(firstMeaningfulLine(result.output) ?? 'Command executed');
    case 'Glob': {
      const lines = result.output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('[Truncated:'));
      return lines.length > 0 ? `Found ${lines.length} path${lines.length > 1 ? 's' : ''}` : 'No matches found';
    }
    default:
      return truncate(result.output);
  }
}
