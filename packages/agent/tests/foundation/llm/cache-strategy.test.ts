import { describe, it, expect } from 'vitest';
import { DefaultCacheStrategy, NoCacheStrategy } from '../../../src/foundation/llm/cache-strategy.js';
import type { Message } from '../../../src/foundation/types.js';

describe('DefaultCacheStrategy', () => {
  const strategy = new DefaultCacheStrategy();

  it('should identify cacheable segments', () => {
    const segments = strategy.identifyCacheableSegments('system prompt', 'skill directory');
    expect(segments).toHaveLength(2);
    expect(segments[0].id).toBe('system-core');
    expect(segments[0].priority).toBe('high');
    expect(segments[1].id).toBe('skills-index');
    expect(segments[1].priority).toBe('medium');
  });

  it('should annotate last message with cache_control', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    const annotated = strategy.annotateMessagesForCache(messages, [
      { id: 'seg-1', description: 'test', content: 'content', priority: 'high' },
    ]);
    expect(annotated[annotated.length - 1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('should not annotate when no cacheable segments', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    const annotated = strategy.annotateMessagesForCache(messages, []);
    expect(annotated[annotated.length - 1].cache_control).toBeUndefined();
  });

  it('should warm cache on turn 1', () => {
    expect(strategy.shouldWarmCache(1)).toBe(true);
    expect(strategy.shouldWarmCache(2)).toBe(false);
    expect(strategy.shouldWarmCache(3)).toBe(false);
  });

  it('should handle empty message list', () => {
    const annotated = strategy.annotateMessagesForCache([], []);
    expect(annotated).toEqual([]);
  });

  it('should handle single message', () => {
    const messages: Message[] = [{ role: 'user', content: 'hello' }];
    const annotated = strategy.annotateMessagesForCache(messages, [
      { id: 'seg-1', description: 'test', content: 'content', priority: 'high' },
    ]);
    expect(annotated).toHaveLength(1);
    expect(annotated[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('NoCacheStrategy', () => {
  const strategy = new NoCacheStrategy();

  it('should return empty segments', () => {
    const segments = strategy.identifyCacheableSegments('system prompt', 'skill directory');
    expect(segments).toEqual([]);
  });

  it('should not annotate messages', () => {
    const messages: Message[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    const annotated = strategy.annotateMessagesForCache(messages, []);
    expect(annotated.every(m => !m.cache_control)).toBe(true);
  });

  it('should not warm cache', () => {
    expect(strategy.shouldWarmCache(1)).toBe(false);
    expect(strategy.shouldWarmCache(2)).toBe(false);
  });
});
