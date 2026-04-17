import { Box } from 'ink';
import type { TranscriptItem } from '../types.js';
import { TranscriptItemView } from './transcript-item.js';

type TranscriptProps = {
  items: TranscriptItem[];
  mode: 'idle' | 'working' | 'approval';
  activeToolLabel?: string | null;
};

export function Transcript({ items }: TranscriptProps) {
  const latestTurnId = [...items].reverse().find((item) => 'turnId' in item && item.turnId)?.turnId;

  let visibleItems = items.slice(-4);
  if (latestTurnId) {
    let startIndex = items.length - 1;
    while (startIndex >= 0) {
      const item = items[startIndex];
      const sameTurn = 'turnId' in item && item.turnId === latestTurnId;
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
        <TranscriptItemView key={item.id} item={item} />
      ))}
    </Box>
  );
}
