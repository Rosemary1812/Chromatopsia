/**
 * tests/repl/recovery.test.ts — Session Recovery Tests
 * P0-1 的测试覆盖
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../src/session/manager.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AnthropicProvider } from '../../src/foundation/llm/anthropic.js';

describe('Session Recovery (P0-1)', () => {
  let tempDir: string;
  let sessionsDir: string;
  let sessionManager: SessionManager;
  let provider: AnthropicProvider;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-recovery-test-'));
    sessionsDir = path.join(tempDir, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    provider = new AnthropicProvider({ api_key: 'test-key' });
    sessionManager = new SessionManager(sessionsDir, provider);
  });

  afterEach(() => {
    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('no active sessions', () => {
    it('should create new session when none exist', async () => {
      const result = await sessionManager.recover_or_prompt('/test/dir');
      
      expect(result).toHaveProperty('session');
      expect(result).toHaveProperty('recovered');
      expect((result as any).recovered).toBe(false);
      expect((result as any).session).toBeDefined();
      expect((result as any).session.working_directory).toBe('/test/dir');
    });
  });

  describe('single active session', () => {
    it('should auto-recover when exactly one active session exists', async () => {
      // Create first session and add a message
      const session1 = sessionManager.create_session('/test/dir');
      session1.add_message({
        role: 'user',
        content: 'hello world'
      });

      // Now try to recover
      const result = await sessionManager.recover_or_prompt('/test/dir');

      expect((result as any).recovered).toBe(true);
      expect((result as any).session.id).toBe(session1.id);
      expect((result as any).session.messages).toHaveLength(1);
      expect((result as any).session.messages[0].content).toBe('hello world');
    });
  });

  describe('multiple active sessions', () => {
    it('should return candidates when multiple active sessions exist', async () => {
      // Create two sessions for same working dir
      const session1 = sessionManager.create_session('/test/dir');
      session1.add_message({ role: 'user', content: 'session 1' });

      const session2 = sessionManager.create_session('/test/dir');
      session2.add_message({ role: 'user', content: 'session 2' });

      // Try to recover
      const result = await sessionManager.recover_or_prompt('/test/dir');

      expect(result).toHaveProperty('candidates');
      expect((result as any).candidates).toHaveLength(2);
      expect((result as any).candidates[0]).toHaveProperty('session_id');
      expect((result as any).candidates[0]).toHaveProperty('working_directory');
      expect((result as any).candidates[0]).toHaveProperty('message_count');
    });

    it('should include message count in candidate info', async () => {
      const session1 = sessionManager.create_session('/test/dir');
      session1.add_message({ role: 'user', content: 'msg1' });
      session1.add_message({ role: 'assistant', content: 'resp1' });

      const session2 = sessionManager.create_session('/test/dir');
      session2.add_message({ role: 'user', content: 'msg2' });

      const result = await sessionManager.recover_or_prompt('/test/dir');

      expect((result as any).candidates[0].message_count).toBe(2);
      expect((result as any).candidates[1].message_count).toBe(1);
    });
  });

  describe('different working directories', () => {
    it('should not recover sessions from different working directories', async () => {
      // Create session for dir1
      const session1 = sessionManager.create_session('/dir1');
      session1.add_message({ role: 'user', content: 'in dir1' });

      // Try to recover for dir2
      const result = await sessionManager.recover_or_prompt('/dir2');

      expect((result as any).recovered).toBe(false);
      expect((result as any).session.working_directory).toBe('/dir2');
      expect((result as any).session.id).not.toBe(session1.id);
    });
  });

  describe('session message persistence', () => {
    it('should restore all messages when recovering', async () => {
      const session1 = sessionManager.create_session('/test/dir');
      
      // Add multiple messages
      session1.add_message({ role: 'user', content: 'first question' });
      session1.add_message({ role: 'assistant', content: 'first answer' });
      session1.add_message({ role: 'user', content: 'second question' });

      // Recover
      const result = await sessionManager.recover_or_prompt('/test/dir');
      const recoveredSession = (result as any).session;

      expect(recoveredSession.messages).toHaveLength(3);
      expect(recoveredSession.messages[0].content).toBe('first question');
      expect(recoveredSession.messages[1].content).toBe('first answer');
      expect(recoveredSession.messages[2].content).toBe('second question');
    });
  });
});
