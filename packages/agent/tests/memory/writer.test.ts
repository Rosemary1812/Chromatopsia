import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm } from 'fs/promises';
import { resolve } from 'path';
import { MemoryIndexStore } from '../../src/memory/index-store.js';
import { MemoryTopicStore } from '../../src/memory/topic-store.js';
import { maybeWriteMemory } from '../../src/memory/writer.js';
import type { LLMProvider, Session } from '../../src/foundation/types.js';

const TEST_DIR = resolve(process.cwd(), '.test-memory-writer');

function makeSession(): Session {
  return {
    id: 's-memory',
    messages: [],
    working_directory: process.cwd(),
    created_at: Date.now(),
    last_active: Date.now(),
    add_message: () => {},
    clear: () => {},
    compact: async () => {},
  };
}

describe('memory/writer', () => {
  const yesProvider: LLMProvider = {
    name: 'mock',
    chat: async () => ({
      content: JSON.stringify({
        should_write: true,
        type: 'user',
        name: 'user-preference',
        description: '用户偏好简洁输出',
        entry: '用户偏好简洁输出',
        confidence: 0.9,
      }),
      finish_reason: 'stop',
    }),
    chat_stream: async function* () {
      yield '';
      return { content: '', finish_reason: 'stop' };
    },
    get_model: () => 'mock',
  };

  const noProvider: LLMProvider = {
    name: 'mock',
    chat: async () => ({
      content: JSON.stringify({
        should_write: false,
        reason: 'one-off',
      }),
      finish_reason: 'stop',
    }),
    chat_stream: async function* () {
      yield '';
      return { content: '', finish_reason: 'stop' };
    },
    get_model: () => 'mock',
  };

  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('writes memory when explicit remember intent is present', async () => {
    const index = new MemoryIndexStore(TEST_DIR);
    const topic = new MemoryTopicStore(TEST_DIR);
    await index.ensure();
    const wrote = await maybeWriteMemory('请记住我喜欢简洁输出', makeSession(), yesProvider, index, topic);
    expect(wrote).toBe(true);
    const entries = await index.listEntries();
    expect(entries.length).toBeGreaterThan(0);
  });

  it('does not write memory for non-memory statements', async () => {
    const index = new MemoryIndexStore(TEST_DIR);
    const topic = new MemoryTopicStore(TEST_DIR);
    await index.ensure();
    const wrote = await maybeWriteMemory('今天测试跑完了吗', makeSession(), noProvider, index, topic);
    expect(wrote).toBe(false);
  });
});

