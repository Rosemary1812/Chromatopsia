import { Box, Text } from 'ink';
import { TUI_THEME, type TranscriptItem } from '../types.js';
import { Markdown } from './markdown.js';

type TranscriptItemProps = {
  item: TranscriptItem;
};

function summarizeToolArguments(item: Extract<TranscriptItem, { kind: 'tool' }>): string | null {
  const args = item.toolCall.arguments;
  if (!args || typeof args !== 'object') return null;

  // 工作流视图优先展示“命令”或“路径”这类人能快速扫读的信息，
  // 剩余参数只保留前几个键值对做摘要。
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
          <Text bold color={TUI_THEME.textPrimary}>{'❯'}</Text>
          <Text color={TUI_THEME.textPrimary}>{item.text}</Text>
        </Box>
      );
    case 'assistant': {
      return (
        <Box flexDirection="column" width="100%">
          <Box columnGap={1}>
            <Text color={TUI_THEME.highlightedText}>{'⏺'}</Text>
            <Markdown text={item.text} />
          </Box>
        </Box>
      );
    }
    case 'tool':
      return (
        <Box flexDirection="column" width="100%">
          <Box columnGap={1}>
            <Text color={TUI_THEME.textDim}>{'✓'}</Text>
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
            {item.level === 'error' ? '✕' : '·'}
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
