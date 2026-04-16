import { Box } from 'ink';
import type { TranscriptItem } from '../types.js';
import { TranscriptItemView } from './transcript-item.js';

type TranscriptProps = {
  items: TranscriptItem[];
  mode: 'idle' | 'working' | 'approval';
  activeToolLabel?: string | null;
};

export function Transcript({ items }: TranscriptProps) {
  const visibleItems = items.slice(-1);

  return (
    <Box flexDirection="column">
      {visibleItems.map((item) => (
        <TranscriptItemView key={item.id} item={item} />
      ))}
    </Box>
  );
}
