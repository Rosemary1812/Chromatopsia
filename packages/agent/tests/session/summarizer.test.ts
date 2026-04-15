import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  compress_session,
  compress_session_recursive,
  needs_compression,
  build_summarize_prompt,
  DEFAULT_COMPRESSION_CONFIG,
} from '../../src/session/summarizer.js';
import type { Message, LLMProvider, CompressionConfig } from '../../src/foundation/types.js';

// Mock LLM Provider
function createMockProvider(summary: string): LLMProvider {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue({ content: summary, finish_reason: 'stop' as const }),
    chat_stream: vi.fn(),
    get_model: vi.fn().mockReturnValue('mock-model'),
  };
}

function createFailingMockProvider(): LLMProvider {
  return {
    name: 'failing',
    chat: vi.fn().mockRejectedValue(new Error('LLM error')),
    chat_stream: vi.fn(),
    get_model: vi.fn().mockReturnValue('mock-model'),
  };
}

function makeMsg(role: Message['role'], content: string, timestamp = 1000): Message {
  return { role, content, timestamp };
}

describe('Session Summarizer', () => {
  describe('needs_compression', () => {
    it('should return false when messages are below threshold', () => {
      const messages = Array.from({ length: 10 }, (_, i) =>
        makeMsg('user', `message ${i}`),
      );
      const config: CompressionConfig = {
        compress_threshold: 4500,
        preserve_recent: 4,
        min_summarizable: 6,
      };
      // 10 messages * 200 = 2000 tokens < 4500
      expect(needs_compression(messages, config)).toBe(false);
    });

    it('should return true when messages exceed threshold', () => {
      const messages = Array.from({ length: 30 }, (_, i) =>
        makeMsg('user', `message ${i}`),
      );
      const config: CompressionConfig = {
        compress_threshold: 4500,
        preserve_recent: 4,
        min_summarizable: 6,
      };
      // 30 messages * 200 = 6000 tokens > 4500
      expect(needs_compression(messages, config)).toBe(true);
    });
  });

  describe('build_summarize_prompt', () => {
    it('should format messages correctly', () => {
      const messages = [
        makeMsg('user', 'Hello'),
        makeMsg('assistant', 'Hi there'),
      ];
      const prompt = build_summarize_prompt(messages);
      expect(prompt).toContain('Hello');
      expect(prompt).toContain('Hi there');
      // 【历史摘要】 tag is added to the summary result, not in the prompt itself
      expect(prompt).toContain('对话历史');
      expect(prompt).toContain('摘要：');
    });
  });

  describe('compress_session', () => {
    it('should truncate when message count is below min_summarizable', async () => {
      const messages = [
        makeMsg('user', 'Hi'),
        makeMsg('assistant', 'Hello'),
        makeMsg('user', 'How are you?'),
      ];
      // only 3 messages, min_summarizable is 6
      const config: CompressionConfig = {
        compress_threshold: 4500,
        preserve_recent: 4,
        min_summarizable: 6,
      };
      const mockProvider = createMockProvider('summary');

      const result = await compress_session(messages, config, mockProvider);

      expect(result.metadata.type).toBe('truncate');
      expect(result.metadata.original_count).toBe(3);
      expect(result.metadata.preserved_count).toBe(3);
      // No LLM call should have been made
      expect(mockProvider.chat).not.toHaveBeenCalled();
    });

    it('should use LLM to summarize when messages are sufficient', async () => {
      const messages = Array.from({ length: 10 }, (_, i) =>
        makeMsg('user', `User message ${i}`),
      );
      const config: CompressionConfig = {
        compress_threshold: 4500,
        preserve_recent: 4,
        min_summarizable: 6,
      };
      const mockProvider = createMockProvider('这是一个对话摘要');

      const result = await compress_session(messages, config, mockProvider);

      expect(result.metadata.type).toBe('summarize');
      expect(result.metadata.original_count).toBe(10);
      // preserved (4 recent) + 1 summary
      expect(result.metadata.preserved_count).toBe(5);
      // First message should be the summary with 【历史摘要】 tag
      expect(result.compressed[0].role).toBe('system');
      expect(result.compressed[0].content).toContain('【历史摘要】');
      expect(result.compressed[0].content).toContain('这是一个对话摘要');
      // Last 4 messages should be preserved
      expect(result.compressed.slice(-4)).toHaveLength(4);
    });

    it('should fall back to truncate when LLM call fails', async () => {
      const messages = Array.from({ length: 10 }, (_, i) =>
        makeMsg('user', `User message ${i}`),
      );
      const config: CompressionConfig = {
        compress_threshold: 4500,
        preserve_recent: 4,
        min_summarizable: 6,
      };
      const mockProvider = createFailingMockProvider();

      const result = await compress_session(messages, config, mockProvider);

      expect(result.metadata.type).toBe('truncate');
      expect(result.metadata.original_count).toBe(10);
    });

    it('should truncate when no LLM provider is provided', async () => {
      const messages = Array.from({ length: 10 }, (_, i) =>
        makeMsg('user', `User message ${i}`),
      );
      const config: CompressionConfig = {
        compress_threshold: 4500,
        preserve_recent: 4,
        min_summarizable: 6,
      };

      const result = await compress_session(messages, config, null as unknown as LLMProvider);

      expect(result.metadata.type).toBe('truncate');
      expect(result.metadata.original_count).toBe(10);
    });

    it('should preserve recent messages correctly', async () => {
      const messages = [
        makeMsg('system', 'System prompt'),
        makeMsg('user', 'First message'),
        makeMsg('assistant', 'Second message'),
        makeMsg('user', 'Third message'),
        makeMsg('assistant', 'Fourth message'),
        makeMsg('user', 'Fifth message'),
        makeMsg('assistant', 'Sixth message'),
        makeMsg('user', 'Seventh message'),
        makeMsg('assistant', 'Eighth message'),
        makeMsg('user', 'Ninth - recent'),
        makeMsg('assistant', 'Tenth - most recent'),
      ];
      const config: CompressionConfig = {
        compress_threshold: 4500,
        preserve_recent: 4,
        min_summarizable: 6,
      };
      const mockProvider = createMockProvider('摘要内容');

      const result = await compress_session(messages, config, mockProvider);

      // compressed = [summary_msg, ...preserved_slice]
      // preserved slice should be last 4 messages
      const lastFour = messages.slice(-4);
      const preservedContent = result.compressed.slice(-4).map(m => m.content);
      expect(preservedContent).toEqual(lastFour.map(m => m.content));
    });

    it('should set compressed_at timestamp', async () => {
      const messages = Array.from({ length: 10 }, (_, i) =>
        makeMsg('user', `msg ${i}`),
      );
      const config: CompressionConfig = {
        compress_threshold: 4500,
        preserve_recent: 4,
        min_summarizable: 6,
      };
      const mockProvider = createMockProvider('summary');
      const before = Date.now();

      const result = await compress_session(messages, config, mockProvider);

      expect(result.metadata.compressed_at).toBeGreaterThanOrEqual(before);
      expect(result.metadata.compressed_at).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('compress_session_recursive', () => {
    it('should stop when compression is no longer needed', async () => {
      // Small messages that won't need multiple rounds
      const messages = Array.from({ length: 8 }, (_, i) =>
        makeMsg('user', `msg ${i}`),
      );
      const config: CompressionConfig = {
        compress_threshold: 500, // very low to trigger compression
        preserve_recent: 2,
        min_summarizable: 3,
      };
      const mockProvider = createMockProvider('summary');

      const result = await compress_session_recursive(messages, config, mockProvider);

      // Should have called compress_session at least once
      expect(mockProvider.chat).toHaveBeenCalled();
      expect(result.metadata.compressed_at).toBeGreaterThan(0);
    });

    it('should respect max_iterations', async () => {
      const messages = Array.from({ length: 30 }, (_, i) =>
        makeMsg('user', `msg ${i}`),
      );
      const config: CompressionConfig = {
        compress_threshold: 100,
        preserve_recent: 2,
        min_summarizable: 3,
      };
      const mockProvider = createMockProvider('summary');

      await compress_session_recursive(messages, config, mockProvider, 2);

      // At most 2 iterations due to max_iterations limit
      expect(mockProvider.chat.mock.calls.length).toBeLessThanOrEqual(2);
    });
  });

  describe('DEFAULT_COMPRESSION_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_COMPRESSION_CONFIG.compress_threshold).toBe(4500);
      expect(DEFAULT_COMPRESSION_CONFIG.preserve_recent).toBe(4);
      expect(DEFAULT_COMPRESSION_CONFIG.min_summarizable).toBe(6);
    });
  });
});
