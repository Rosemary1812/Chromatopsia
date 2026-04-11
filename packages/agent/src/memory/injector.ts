import type { Message } from '../foundation/types.js';
import type { MemoryIndexStore } from './index-store.js';
import type { MemoryTopicStore } from './topic-store.js';
import { pickRelevantMemories, shouldReadMemory } from './router.js';

export interface MemoryInjectionResult {
  systemMessages: Message[];
  loadedFiles: string[];
}

export async function buildMemoryInjection(
  input: string,
  indexStore: MemoryIndexStore,
  topicStore: MemoryTopicStore,
): Promise<MemoryInjectionResult> {
  const systemMessages: Message[] = [];
  const loadedFiles: string[] = [];

  const rawIndex = await indexStore.readRaw();
  systemMessages.push({
    role: 'system',
    content: [
      '【Memory系统】',
      '你有一个基于文件的记忆系统。',
      '先看 MEMORY.md 索引，再按需读取主题记忆。',
      '仅在必要时读取主题文件，避免全量加载。',
      '',
      rawIndex.trim(),
    ].join('\n'),
  });

  if (!shouldReadMemory(input)) {
    return { systemMessages, loadedFiles };
  }

  const entries = await indexStore.listEntries();
  const relevant = pickRelevantMemories(input, entries, 3);
  for (const item of relevant) {
    try {
      const raw = await topicStore.read(item.file);
      loadedFiles.push(item.file);
      systemMessages.push({
        role: 'system',
        content: `【Memory Topic: ${item.name}】\n${raw}`,
      });
    } catch {
      // Skip unreadable files
    }
  }

  if (loadedFiles.length > 0) {
    systemMessages.push({
      role: 'system',
      content: `【Memory注入说明】本轮已按需加载主题记忆：${loadedFiles.join(', ')}`,
    });
  }

  return { systemMessages, loadedFiles };
}

