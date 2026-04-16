import { Box, Text } from 'ink';
import { TUI_THEME } from '../types.js';

type FooterProps = {
  model: string;
  tokenCount?: number;
};

function formatTokenCount(tokenCount: number): string {
  if (tokenCount >= 1000) {
    return `${(tokenCount / 1000).toFixed(1)}k tokens`;
  }
  return `${tokenCount} tokens`;
}

export function Footer({ model, tokenCount = 0 }: FooterProps) {
  return (
    <Box paddingX={2} width="100%">
      <Box flexGrow={1} justifyContent="flex-start">
        <Text color={TUI_THEME.textDim}>{model}</Text>
      </Box>
      <Box justifyContent="flex-end">
        <Text color={TUI_THEME.textDim}>{formatTokenCount(tokenCount)}</Text>
      </Box>
    </Box>
  );
}
