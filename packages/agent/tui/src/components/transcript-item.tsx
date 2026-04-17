import { Box, Text } from 'ink';
import { TUI_THEME, type TranscriptItem } from '../types.js';
import { Markdown } from './markdown.js';

const ASSISTANT_MARKER = '\u25CF';
const USER_MARKER = '\u276F';
const TOOL_MARKER = '\u2713';
const ERROR_MARKER = '\u2715';
const INFO_MARKER = '\u00B7';

type TranscriptItemProps = {
  item: TranscriptItem;
};

function summarizeToolArguments(item: Extract<TranscriptItem, { kind: 'tool' }>): string | null {
  const args = item.toolCall.arguments;
  if (!args || typeof args !== 'object') return null;

  if ('command' in args && typeof args.command === 'string') {
    return args.command;
  }

  const pathValue =
    ('path' in args && typeof args.path === 'string' && args.path) ||
    ('file_path' in args && typeof args.file_path === 'string' && args.file_path) ||
    ('target_path' in args && typeof args.target_path === 'string' && args.target_path);

  if (pathValue) {
    return pathValue;
  }

  const entries = Object.entries(args).slice(0, 2);
  if (entries.length === 0) return null;
  return entries
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' · ');
}

export function TranscriptItemView({ item }: TranscriptItemProps) {
  switch (item.kind) {
    case 'user':
      return (
        <Box columnGap={1} width="100%">
          <Text bold color={TUI_THEME.textPrimary}>{USER_MARKER}</Text>
          <Text color={TUI_THEME.textPrimary}>{item.text}</Text>
        </Box>
      );
    case 'assistant': {
      return (
        <Box flexDirection="column" width="100%">
          <Box columnGap={1}>
            <Text color={TUI_THEME.primary}>{ASSISTANT_MARKER}</Text>
            <Markdown text={item.text} />
          </Box>
        </Box>
      );
    }
    case 'tool':
      return (
        <Box flexDirection="column" width="100%">
          <Box columnGap={1}>
            <Text color={TUI_THEME.textDim}>{TOOL_MARKER}</Text>
            <Text color={TUI_THEME.textDim}>
              {item.summary ?? `${item.name} ${item.status === 'running' ? 'in progress' : 'completed'}`}
            </Text>
          </Box>
          {summarizeToolArguments(item) ? (
            <Text color={TUI_THEME.textDim}>{`└─ ${summarizeToolArguments(item)}`}</Text>
          ) : null}
        </Box>
      );
    case 'notification':
      return (
        <Box columnGap={1}>
          <Text color={item.level === 'error' ? TUI_THEME.danger : TUI_THEME.info}>
            {item.level === 'error' ? ERROR_MARKER : INFO_MARKER}
          </Text>
          <Text color={item.level === 'error' ? TUI_THEME.danger : TUI_THEME.textDim}>{item.text}</Text>
        </Box>
      );
    case 'command_help':
      return (
        <Box flexDirection="column">
          <Markdown text={item.text} />
        </Box>
      );
  }
}
