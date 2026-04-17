import { Box, Text } from 'ink';
import type { TuiThemePalette } from '../types.js';

type FooterProps = {
  model: string;
  tokenCount?: number;
  theme: TuiThemePalette;
};

function formatTokenCount(tokenCount: number): string {
  if (tokenCount >= 1000) {
    return `${(tokenCount / 1000).toFixed(1)}k tokens`;
  }
  return `${tokenCount} tokens`;
}

export function Footer({ model, tokenCount = 0, theme }: FooterProps) {
  return (
    <Box paddingX={2} width="100%">
      <Box flexGrow={1} justifyContent="flex-start">
        <Text color={theme.textDim}>{model}</Text>
      </Box>
      <Box justifyContent="flex-end">
        <Text color={theme.textDim}>{formatTokenCount(tokenCount)}</Text>
      </Box>
    </Box>
  );
}
