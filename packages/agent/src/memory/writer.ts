import type { Session } from '../foundation/types.js';
import type { MemoryIndexStore } from './index-store.js';
import type { MemoryTopicStore } from './topic-store.js';
import type { LLMProvider, MemoryType } from '../foundation/types.js';
import { decideMemoryWrite } from './decider.js';

function trimLine(input: string, max = 180): string {
  const oneLine = input.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function inferTopicName(type: MemoryType, text: string): string {
  const base = trimLine(text, 36).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
  return `${type}-${base || 'note'}`;
}

export async function maybeWriteMemory(
  input: string,
  session: Session,
  provider: LLMProvider,
  indexStore: MemoryIndexStore,
  topicStore: MemoryTopicStore,
): Promise<boolean> {
  const decision = await decideMemoryWrite(provider, input, session.messages);
  if (!decision.should_write) return false;

  const type: MemoryType = decision.type ?? 'feedback';
  const description = trimLine(decision.description ?? input, 120);
  const name = decision.name ? trimLine(decision.name, 60) : inferTopicName(type, input);
  const entryText = trimLine(decision.entry ?? input, 220);
  const confidence = typeof decision.confidence === 'number' ? decision.confidence : 0.8;

  const { file, updated_at } = await topicStore.appendEntry({
    name,
    description,
    type,
    entry: `${entryText} (session=${session.id})`,
    confidence,
  });

  await indexStore.upsertEntry({
    name,
    file,
    description,
    type,
    updated_at,
  });

  return true;
}

