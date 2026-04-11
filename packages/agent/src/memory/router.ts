import type { MemoryIndexEntry } from '../foundation/types.js';

const TYPE_HINTS: Array<{ type: string; words: string[] }> = [
  { type: 'user', words: ['偏好', '喜欢', '习惯', '我上次', '按我之前'] },
  { type: 'feedback', words: ['纠正', '你应该', '下次', '不要这样'] },
  { type: 'project', words: ['项目', '任务', '当前在做', '背景'] },
  { type: 'reference', words: ['api', '地址', '数据库', 'linear', '链接', 'endpoint'] },
];

function scoreEntry(input: string, entry: MemoryIndexEntry): number {
  const q = input.toLowerCase();
  let score = 0;
  if (q.includes(entry.name.toLowerCase())) score += 3;
  if (q.includes(entry.description.toLowerCase())) score += 4;
  if (entry.type) {
    const hint = TYPE_HINTS.find((h) => h.type === entry.type);
    if (hint && hint.words.some((w) => q.includes(w.toLowerCase()))) score += 5;
  }
  return score;
}

export function shouldReadMemory(input: string): boolean {
  const q = input.toLowerCase();
  return [
    '记住',
    '上次',
    '之前',
    '为什么这次',
    '偏好',
    '纠正',
    '按我',
    'reference',
  ].some((kw) => q.includes(kw));
}

export function pickRelevantMemories(input: string, entries: MemoryIndexEntry[], topK: number = 3): MemoryIndexEntry[] {
  return entries
    .map((entry) => ({ entry, score: scoreEntry(input, entry) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((item) => item.entry);
}

