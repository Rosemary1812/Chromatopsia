/**
 * Session History 单元测试
 *
 * 测试范围：
 * 1. append_message 追加正确（一行一条 JSONL）
 * 2. load_session 正确反序列化
 * 3. archive_session 正确标记 archived
 * 4. list_sessions 正确返回未归档的 session
 * 5. 重复创建同名 session：后者覆盖前者
 * 6. 损坏的 JSONL 文件：load_session 跳过损坏行
 * 7. 所有操作在临时目录中进行
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm } from 'fs/promises';
import { resolve } from 'path';
import { SessionHistory } from '../../src/session/history.js';
import type { Message } from '../../src/foundation/types.js';

const TEST_DIR = resolve(process.cwd(), '.test-session-temp');

let history: SessionHistory;

beforeEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
  history = new SessionHistory(TEST_DIR);
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('SessionHistory', () => {
  describe('append_message & load_session', () => {
    it('appends a single message as one JSON line', async () => {
      const msg: Message = { role: 'user', content: 'hello' };
      await history.append_message('s1', msg);
      const msgs = await history.load_session('s1');
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toEqual(msg);
    });

    it('appends multiple messages each on its own line', async () => {
      const msg1: Message = { role: 'user', content: 'hello' };
      const msg2: Message = { role: 'assistant', content: 'hi' };
      await history.append_message('s1', msg1);
      await history.append_message('s1', msg2);
      const msgs = await history.load_session('s1');
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe('hello');
      expect(msgs[1].content).toBe('hi');
    });

    it('load_session returns empty array for nonexistent session', async () => {
      const msgs = await history.load_session('nonexistent');
      expect(msgs).toEqual([]);
    });
  });

  describe('list_sessions', () => {
    it('lists only non-archived sessions', async () => {
      await history.append_message('s1', { role: 'user', content: 'a' });
      await history.append_message('s2', { role: 'user', content: 'b' });
      await history.append_message('s3', { role: 'user', content: 'c' });
      await history.archive_session('s2');
      const sessions = await history.list_sessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map((e) => e.session_id).sort()).toEqual(['s1', 's3']);
    });

    it('returns empty array when no sessions exist', async () => {
      const sessions = await history.list_sessions();
      expect(sessions).toEqual([]);
    });

    it('updates message_count on append', async () => {
      await history.append_message('s1', { role: 'user', content: 'a' });
      await history.append_message('s1', { role: 'assistant', content: 'b' });
      await history.append_message('s1', { role: 'user', content: 'c' });
      const sessions = await history.list_sessions();
      expect(sessions[0].message_count).toBe(3);
    });
  });

  describe('archive_session', () => {
    it('marks session as archived', async () => {
      await history.append_message('s1', { role: 'user', content: 'hello' });
      await history.archive_session('s1');
      const sessions = await history.list_sessions();
      expect(sessions).toHaveLength(0);
    });

    it('does not throw for nonexistent session', () => {
      expect(history.archive_session('nonexistent')).toBeUndefined();
    });
  });

  describe('create_session', () => {
    it('creates a session entry without messages', async () => {
      await history.create_session('s1', '/tmp/project');
      const sessions = await history.list_sessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].session_id).toBe('s1');
      expect(sessions[0].working_directory).toBe('/tmp/project');
      expect(sessions[0].message_count).toBe(0);
    });

    it('overwrites existing session entry', async () => {
      await history.create_session('s1', '/tmp/old');
      await history.create_session('s1', '/tmp/new');
      const sessions = await history.list_sessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].working_directory).toBe('/tmp/new');
    });
  });

  describe('corrupted JSONL handling', () => {
    it('load_session skips corrupted lines', async () => {
      // Manually write corrupted JSONL
      const { writeFile, mkdir } = await import('fs/promises');
      await mkdir(TEST_DIR, { recursive: true });
      const corruptedPath = resolve(TEST_DIR, 'corrupt.jsonl');
      await writeFile(corruptedPath, '{"role":"user","content":"good"}\nnot valid json\n{"role":"assistant","content":"ok"}\n', 'utf-8');

      // Manually create an index entry for this session
      const index_path = resolve(TEST_DIR, 'index.json');
      await writeFile(index_path, JSON.stringify({
        sessions: [{ session_id: 'corrupt', working_directory: '', created_at: Date.now(), last_active: Date.now(), message_count: 3 }]
      }), 'utf-8');

      const msgs = await history.load_session('corrupt');
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe('good');
      expect(msgs[1].content).toBe('ok');
    });
  });
});
