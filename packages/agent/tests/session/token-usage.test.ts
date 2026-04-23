/**
 * P1-6: Token 使用量统计测试
 * 
 * 测试 SessionImpl 的 token 统计功能：
 * - getTokenStats(model): 获取当前 token 使用量、阈值、剩余、百分比
 * - should_compact_with_model(model, threshold): 判断是否应该压缩
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm } from 'fs/promises';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { SessionManager } from '../../src/session/manager.js';
import type { Message, LLMProvider } from '../../src/foundation/types.js';

function make_test_dir() {
  return resolve(process.cwd(), '.test-token-' + randomUUID().slice(0, 8));
}

/** Mock LLMProvider */
function createMockProvider(): LLMProvider {
  return {
    name: 'mock',
    chat: async () => { throw new Error('mock provider'); },
    chat_stream: async function* () { throw new Error('mock provider'); },
    get_model: () => 'claude-3-5-sonnet-20241022',
  };
}

describe('Session Token Usage (P1-6)', () => {
  const dir = make_test_dir();
  let manager: SessionManager;

  beforeEach(async () => {
    manager = new SessionManager(dir, createMockProvider());
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('getTokenStats', () => {
    it('returns correct token stats for empty session', () => {
      const session = manager.create_session('/tmp/project');
      const stats = (session as any).getTokenStats('claude-3-5-sonnet-20241022');

      expect(stats).toBeDefined();
      expect(stats.current).toBe(50); // System overhead only
      expect(stats.max).toBe(200_000); // Claude 3.5 Sonnet
      expect(stats.remaining).toBe(200_000 - 50);
      expect(stats.percentage).toBe(0); // 0% = 50 / 200_000
      expect(stats.warn).toBe(false);
    });

    it('calculates token usage correctly with messages', () => {
      const session = manager.create_session('/tmp/project');
      const msg: Message = {
        role: 'user',
        content: 'a'.repeat(4000), // ~1000 tokens
      };
      session.add_message(msg);

      const stats = (session as any).getTokenStats('claude-3-5-sonnet-20241022');

      // 1000 (message) + 20 (overhead) + 50 (system) = ~1070
      expect(stats.current).toBeGreaterThan(1000);
      expect(stats.percentage).toBeGreaterThan(0);
      expect(stats.warn).toBe(false);
    });

    it('sets warn flag when fill rate exceeds 80%', () => {
      const session = manager.create_session('/tmp/project');
      
      // Add many messages to exceed 80% threshold
      // Claude 3.5: 200k max, so need > 160k tokens
      // Each message: ~8000 chars = ~2200 tokens
      // Need ~73 messages
      for (let i = 0; i < 75; i++) {
        session.add_message({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'x'.repeat(8000),
        });
      }

      const stats = (session as any).getTokenStats('claude-3-5-sonnet-20241022');
      
      expect(stats.percentage).toBeGreaterThanOrEqual(80);
      expect(stats.warn).toBe(true);
    });

    it('works with different model names', () => {
      const session = manager.create_session('/tmp/project');
      session.add_message({
        role: 'user',
        content: 'test message',
      });

      // Claude model (200k)
      const claudeStats = (session as any).getTokenStats('claude-3-opus-20240229');
      expect(claudeStats.max).toBe(200_000);

      // GPT-4 model (8k)
      const gptStats = (session as any).getTokenStats('gpt-4');
      expect(gptStats.max).toBe(8_192);

      // GPT-4 Turbo (128k)
      const turboStats = (session as any).getTokenStats('gpt-4-turbo');
      expect(turboStats.max).toBe(128_000);
    });

    it('remaining tokens are max - current', () => {
      const session = manager.create_session('/tmp/project');
      session.add_message({
        role: 'user',
        content: 'test',
      });

      const stats = (session as any).getTokenStats('claude-3-5-sonnet-20241022');
      expect(stats.remaining).toBe(stats.max - stats.current);
    });

    it('percentage is correct integer', () => {
      const session = manager.create_session('/tmp/project');
      session.add_message({
        role: 'user',
        content: 'a'.repeat(4000),
      });

      const stats = (session as any).getTokenStats('claude-3-5-sonnet-20241022');
      
      // Should be integer 0-100
      expect(Number.isInteger(stats.percentage)).toBe(true);
      expect(stats.percentage).toBeGreaterThanOrEqual(0);
      expect(stats.percentage).toBeLessThanOrEqual(100);
    });
  });

  describe('should_compact_with_model', () => {
    it('returns false for small session', () => {
      const session = manager.create_session('/tmp/project');
      session.add_message({
        role: 'user',
        content: 'short',
      });

      const shouldCompact = (session as any).should_compact_with_model(
        'claude-3-5-sonnet-20241022',
        0.8
      );
      expect(shouldCompact).toBe(false);
    });

    it('returns true when exceeding threshold', () => {
      const session = manager.create_session('/tmp/project');
      
      // Add enough messages to exceed 80%
      for (let i = 0; i < 75; i++) {
        session.add_message({
          role: 'user',
          content: 'x'.repeat(8000),
        });
      }

      const shouldCompact = (session as any).should_compact_with_model(
        'claude-3-5-sonnet-20241022',
        0.8
      );
      expect(shouldCompact).toBe(true);
    });

    it('respects custom threshold', () => {
      const session = manager.create_session('/tmp/project');
      
      // Add messages to reach ~50%
      for (let i = 0; i < 40; i++) {
        session.add_message({
          role: 'user',
          content: 'x'.repeat(5000),
        });
      }

      const stats = (session as any).getTokenStats('claude-3-5-sonnet-20241022');
      const fillRate = stats.percentage / 100;

      // Should return false for threshold > fillRate
      if (fillRate < 0.6) {
        const result = (session as any).should_compact_with_model(
          'claude-3-5-sonnet-20241022',
          0.6
        );
        expect(result).toBe(false);
      }

      // Should return true for threshold < fillRate  
      if (fillRate > 0.3) {
        const result = (session as any).should_compact_with_model(
          'claude-3-5-sonnet-20241022',
          0.3
        );
        expect(result).toBe(true);
      }
    });

    it('works with different models', () => {
      const session = manager.create_session('/tmp/project');
      
      // Add a moderate amount of content
      for (let i = 0; i < 10; i++) {
        session.add_message({
          role: 'user',
          content: 'x'.repeat(4000),
        });
      }

      const tokenStats = (session as any).getTokenStats('gpt-4');
      const smallModelCompact = (session as any).should_compact_with_model('gpt-4', 0.8);
      
      // Small model should be closer to limit
      const largeModelCompact = (session as any).should_compact_with_model(
        'claude-3-5-sonnet-20241022',
        0.8
      );

      // GPT-4 (8k) should hit limit faster than Claude (200k)
      expect(smallModelCompact).toBe(true); // Should need compaction
      expect(largeModelCompact).toBe(false); // Should have plenty of space
    });
  });

  describe('integration with session', () => {
    it('token stats reflect messages added', () => {
      const session = manager.create_session('/tmp/project');
      
      const stats1 = (session as any).getTokenStats('claude-3-5-sonnet-20241022');
      const initial = stats1.current;

      session.add_message({
        role: 'user',
        content: 'x'.repeat(2000),
      });

      const stats2 = (session as any).getTokenStats('claude-3-5-sonnet-20241022');
      expect(stats2.current).toBeGreaterThan(initial);
    });

    it('token stats reflect messages after clear', () => {
      const session = manager.create_session('/tmp/project');
      session.add_message({
        role: 'user',
        content: 'x'.repeat(4000),
      });

      const statsBefore = (session as any).getTokenStats('claude-3-5-sonnet-20241022');
      session.clear();
      const statsAfter = (session as any).getTokenStats('claude-3-5-sonnet-20241022');

      // After clear, should only have system overhead
      expect(statsAfter.current).toBeLessThan(statsBefore.current);
      expect(statsAfter.current).toBe(50); // Just system overhead
    });

    it('token stats work with tool calls', () => {
      const session = manager.create_session('/tmp/project');
      
      const msgWithTools: Message = {
        role: 'assistant',
        content: 'I will run the command',
        tool_calls: [
          {
            id: 'tool-1',
            name: 'run_shell',
            arguments: { command: 'ls -la' },
          },
        ],
      };
      session.add_message(msgWithTools);

      const stats = (session as any).getTokenStats('claude-3-5-sonnet-20241022');
      expect(stats.current).toBeGreaterThan(50);
      expect(stats.warn).toBe(false);
    });
  });
});
