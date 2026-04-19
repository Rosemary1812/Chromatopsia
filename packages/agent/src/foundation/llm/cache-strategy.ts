import type { Message } from '../../foundation/types.js';

export interface CacheableSegment {
  id: string;
  description: string;
  content: string;
  priority: 'high' | 'medium' | 'low'; // high: core system, medium: static context, low: dynamic skill list
}

export interface CacheStrategy {
  /**
   * 标记哪些消息段可缓存
   */
  identifyCacheableSegments(systemPrompt: string, skillDirectory: string): CacheableSegment[];

  /**
   * 构造带缓存提示的 message 列表
   */
  annotateMessagesForCache(
    messages: Message[],
    cacheableSegments: CacheableSegment[]
  ): Array<Message & { cache_control?: { type: 'ephemeral' } }>;

  /**
   * 预热缓存（首轮调用）
   */
  shouldWarmCache(turnNumber: number): boolean;
}

export class DefaultCacheStrategy implements CacheStrategy {
  identifyCacheableSegments(systemPrompt: string, skillDirectory: string): CacheableSegment[] {
    return [
      {
        id: 'system-core',
        description: 'Core system prompt (stable across turns)',
        content: systemPrompt,
        priority: 'high',
      },
      {
        id: 'skills-index',
        description: 'Skill directory listing (changes rarely)',
        content: skillDirectory,
        priority: 'medium',
      },
    ];
  }

  annotateMessagesForCache(
    messages: Message[],
    cacheableSegments: CacheableSegment[]
  ): Array<Message & { cache_control?: { type: 'ephemeral' } }> {
    // Mark the last message in each cacheable segment with cache_control
    // This tells Anthropic to cache everything up to this point
    return messages.map((msg, idx) => {
      const shouldCache = idx === messages.length - 1 && cacheableSegments.length > 0;
      return {
        ...msg,
        ...(shouldCache && { cache_control: { type: 'ephemeral' } }),
      };
    });
  }

  shouldWarmCache(turnNumber: number): boolean {
    // Always warm on first turn
    return turnNumber === 1;
  }
}

/**
 * No-op cache strategy for providers that don't support caching (e.g., OpenAI)
 */
export class NoCacheStrategy implements CacheStrategy {
  identifyCacheableSegments(): CacheableSegment[] {
    return [];
  }

  annotateMessagesForCache(messages: Message[]): Array<Message & { cache_control?: { type: 'ephemeral' } }> {
    return messages as any[];
  }

  shouldWarmCache(): boolean {
    return false;
  }
}
