import { Box, Text, useInput } from 'ink';
import type { ApprovalRequest } from '@chromatopsia/agent';
import { TUI_THEME } from '../types.js';

type ApprovalPromptProps = {
  request: ApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
};

export function ApprovalPrompt({ request, onApprove, onReject }: ApprovalPromptProps) {
  useInput((input) => {
    const normalized = input.trim().toLowerCase();
    if (normalized === 'y') {
      onApprove();
    } else if (normalized === 'n') {
      onReject();
    }
  });

  const args = Object.entries(request.args)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(', ')
    .slice(0, 500);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={TUI_THEME.warning}
      paddingX={1}
    >
      <Text bold color={TUI_THEME.warning}>
        {'⚠️ Agent wants to run a high-risk tool: '}
        <Text color={TUI_THEME.textPrimary}>{request.tool_name}</Text>
      </Text>
      {args ? <Text color={TUI_THEME.textDim}>{args}</Text> : null}
      <Text bold color={TUI_THEME.warning}>
        {'Allow execution? ['}
        <Text color={TUI_THEME.success}>{'y'}</Text>
        {'/N]'}
      </Text>
    </Box>
  );
}
