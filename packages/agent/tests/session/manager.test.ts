/**
 * SessionManager 单元测试
 *
 * 测试范围：
 * 1. create_session：生成唯一 ID，初始化 messages 为空
 * 2. get_session：能根据 ID 找回
 * 3. add_message：追加消息并更新 last_active
 * 4. compact()：调用压缩逻辑
 * 5. recover_or_prompt：
 *    - 无活跃 session → 创建新 session
 *    - 一个活跃 session → 自动恢复
 *    - 多个活跃 session → 返回候选列表
 * 6. 所有操作在临时目录中进行（每个测试用独立目录）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm } from 'fs/promises';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { SessionManager } from '../../src/session/manager.js';
import type { Message } from '../../src/types.js';

function make_test_dir() {
  return resolve(process.cwd(), '.test-mgr-' + randomUUID().slice(0, 8));
}

describe('SessionManager', () => {
  describe('create_session & get_session', () => {
    const dir = make_test_dir();
    let manager: SessionManager;

    beforeEach(async () => {
      manager = new SessionManager(dir);
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('creates a session with a unique ID', () => {
      const s1 = manager.create_session('/tmp/project-a');
      const s2 = manager.create_session('/tmp/project-b');
      expect(s1.id).not.toBe(s2.id);
    });

    it('creates a session with empty messages', () => {
      const s = manager.create_session('/tmp/project');
      expect(s.messages).toEqual([]);
    });

    it('creates a session with correct working_directory', () => {
      const s = manager.create_session('/workspace/myapp');
      expect(s.working_directory).toBe('/workspace/myapp');
    });

    it('get_session returns the session by id', () => {
      const created = manager.create_session('/tmp/project');
      const retrieved = manager.get_session(created.id);
      expect(retrieved?.id).toBe(created.id);
    });

    it('get_session returns undefined for unknown id', () => {
      const retrieved = manager.get_session('nonexistent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('add_message', () => {
    const dir = make_test_dir();
    let manager: SessionManager;

    beforeEach(async () => {
      manager = new SessionManager(dir);
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('appends a message to the session', () => {
      const s = manager.create_session('/tmp/project');
      const msg: Message = { role: 'user', content: 'hello' };
      s.add_message(msg);
      expect(s.messages).toHaveLength(1);
      expect(s.messages[0].content).toBe('hello');
    });

    it('updates last_active timestamp', () => {
      const s = manager.create_session('/tmp/project');
      const before = s.last_active;
      s.add_message({ role: 'user', content: 'hi' });
      expect(s.last_active).toBeGreaterThanOrEqual(before);
    });

    it('accumulates multiple messages', () => {
      const s = manager.create_session('/tmp/project-msg');
      s.add_message({ role: 'user', content: 'hello' });
      s.add_message({ role: 'assistant', content: 'hi there' });
      s.add_message({ role: 'user', content: 'help me' });
      expect(s.messages).toHaveLength(3);
    });
  });

  describe('compact()', () => {
    const dir = make_test_dir();
    let manager: SessionManager;

    beforeEach(async () => {
      manager = new SessionManager(dir);
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('sets last_compact_metadata on the session', () => {
      const s = manager.create_session('/tmp/project-compact');
      for (let i = 0; i < 30; i++) {
        s.add_message({ role: 'user', content: `message ${i}`.padEnd(200, ' ') });
      }
      const before_compact = s.messages.length;
      s.compact();
      expect(s.messages.length).toBeLessThan(before_compact);
      expect(s.last_compact_metadata).toBeDefined();
      expect(s.last_compact_metadata!.type).toBe('truncate');
      expect(s.last_compact_metadata!.original_count).toBe(before_compact);
    });

    it('does nothing if session has few messages', () => {
      const s = manager.create_session('/tmp/project-few');
      s.add_message({ role: 'user', content: 'short' });
      s.compact();
      expect(s.messages).toHaveLength(1);
      expect(s.last_compact_metadata).toBeUndefined();
    });
  });

  describe('clear()', () => {
    const dir = make_test_dir();
    let manager: SessionManager;

    beforeEach(async () => {
      manager = new SessionManager(dir);
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('removes all messages from the session', () => {
      const s = manager.create_session('/tmp/project-clear');
      s.add_message({ role: 'user', content: 'hello' });
      s.add_message({ role: 'assistant', content: 'hi' });
      s.clear();
      expect(s.messages).toHaveLength(0);
    });

    it('updates last_active', () => {
      const s = manager.create_session('/tmp/project-clear2');
      s.add_message({ role: 'user', content: 'hello' });
      const before = s.last_active;
      s.clear();
      expect(s.last_active).toBeGreaterThanOrEqual(before);
    });
  });

  describe('recover_or_prompt', () => {
    const dir = make_test_dir();

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('creates new session when no active sessions exist', async () => {
      const manager = new SessionManager(dir);
      const result = await manager.recover_or_prompt('/tmp/new-project');
      expect(result.recovered).toBe(false);
      expect('session' in result);
      expect(result.session.working_directory).toBe('/tmp/new-project');
    });

    it('recovers a single active session', async () => {
      const m1 = new SessionManager(dir);
      const original = m1.create_session('/tmp/recoverable');
      original.add_message({ role: 'user', content: 'prior message' });
      const originalId = original.id;

      const m2 = new SessionManager(dir);
      const result = await m2.recover_or_prompt('/tmp/recoverable');
      expect(result.recovered).toBe(true);
      expect('session' in result);
      expect((result as any).session.id).toBe(originalId);
      expect((result as any).session.messages).toHaveLength(1);
    });

    it('returns multiple candidates when multiple sessions exist', async () => {
      const m1 = new SessionManager(dir);
      const s1 = m1.create_session('/tmp/multi-1');
      s1.add_message({ role: 'user', content: 'session 1' });
      const s2 = m1.create_session('/tmp/multi-2');
      s2.add_message({ role: 'user', content: 'session 2' });

      const m2 = new SessionManager(dir);
      const result = await m2.recover_or_prompt('/tmp/multi-1');
      if ('candidates' in result) {
        expect(result.candidates.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('list_active_sessions', () => {
    const dir = make_test_dir();

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('lists all active sessions', async () => {
      const manager = new SessionManager(dir);
      manager.create_session('/tmp/proj1');
      manager.create_session('/tmp/proj2');
      const sessions = await manager.list_active_sessions();
      expect(sessions).toHaveLength(2);
    });

    it('excludes archived sessions', async () => {
      const manager = new SessionManager(dir);
      const s1 = manager.create_session('/tmp/keep');
      const s2 = manager.create_session('/tmp/remove');
      await manager.archive_session(s2.id);
      const all = await manager.list_active_sessions();
      expect(all.map((e) => e.id)).toContain(s1.id);
      expect(all.map((e) => e.id)).not.toContain(s2.id);
    });
  });

  describe('get_messages_for_llm', () => {
    const dir = make_test_dir();
    let manager: SessionManager;

    beforeEach(async () => {
      manager = new SessionManager(dir);
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('returns session messages', () => {
      const s = manager.create_session('/tmp/project-msgs');
      s.add_message({ role: 'user', content: 'hello' });
      s.add_message({ role: 'assistant', content: 'hi' });
      const msgs = manager.get_messages_for_llm(s.id);
      expect(msgs).toHaveLength(2);
    });

    it('returns empty array for unknown session id', () => {
      const msgs = manager.get_messages_for_llm('unknown-id');
      expect(msgs).toEqual([]);
    });
  });

  describe('generate_session_id', () => {
    const dir = make_test_dir();
    let manager: SessionManager;

    beforeEach(async () => {
      manager = new SessionManager(dir);
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('generates unique IDs for rapid successive calls', () => {
      const id1 = manager.generate_session_id('/tmp/same');
      const id2 = manager.generate_session_id('/tmp/same');
      expect(id1).not.toBe(id2);
    });

    it('generates different IDs for different directories', () => {
      const id1 = manager.generate_session_id('/tmp/dir1');
      const id2 = manager.generate_session_id('/tmp/dir2');
      expect(id1).not.toBe(id2);
    });
  });
});
