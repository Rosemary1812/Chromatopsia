import { Box } from 'ink';
import type { TranscriptItem, TuiThemePalette } from '../types.js';
import { TranscriptItemView } from './transcript-item.js';

type TranscriptProps = {
  items: TranscriptItem[];
  mode: 'idle' | 'working' | 'approval';
  activeToolLabel?: string | null;
  theme: TuiThemePalette;
};

function getTurnId(item: TranscriptItem): string | undefined {
  switch (item.kind) {
    case 'user':
    case 'assistant':
    case 'tool':
      return item.turnId;
    default:
      return undefined;
  }
}

export function Transcript({ items, theme }: TranscriptProps) {
  const latestTurnId = [...items]
    .reverse()
    .map((item) => getTurnId(item))
    .find((turnId) => Boolean(turnId));

  let visibleItems = items.slice(-4);
  if (latestTurnId) {
    let startIndex = items.length - 1;
    while (startIndex >= 0) {
      const item = items[startIndex];
      const sameTurn = getTurnId(item) === latestTurnId;
      const isNotification = item.kind === 'notification';
      if (!sameTurn && !isNotification) {
        break;
      }
      startIndex -= 1;
    }
    visibleItems = items.slice(startIndex + 1);
  }

  return (
    <Box flexDirection="column">
      {visibleItems.map((item) => (
        <TranscriptItemView key={item.id} item={item} theme={theme} />
      ))}
    </Box>
  );
}
