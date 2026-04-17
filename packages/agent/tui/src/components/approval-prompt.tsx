import { Box, Text, useInput } from 'ink';
import type { ApprovalRequest } from '@chromatopsia/agent';
import type { TuiThemePalette } from '../types.js';

type ApprovalPromptProps = {
  request: ApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
  theme: TuiThemePalette;
};

export function ApprovalPrompt({ request, onApprove, onReject, theme }: ApprovalPromptProps) {
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
      borderColor={theme.warning}
      paddingX={1}
    >
      <Text bold color={theme.warning}>
        {'⚠️ Agent wants to run a high-risk tool: '}
        <Text color={theme.textPrimary}>{request.tool_name}</Text>
      </Text>
      {args ? <Text color={theme.textDim}>{args}</Text> : null}
      <Text bold color={theme.warning}>
        {'Allow execution? ['}
        <Text color={theme.success}>{'y'}</Text>
        {'/N]'}
      </Text>
    </Box>
  );
}
