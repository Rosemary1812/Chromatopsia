import type { ToolCall, ToolResult } from '@chromatopsia/agent';

function truncate(value: string, maxLength = 120): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
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
      return 'Command executed';
    default:
      return truncate(result.output);
  }
}
