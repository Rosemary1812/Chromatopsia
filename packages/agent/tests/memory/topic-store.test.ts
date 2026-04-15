import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, rm } from 'fs/promises';
import { resolve } from 'path';
import { MemoryTopicStore } from '../../src/memory/topic-store.js';

const TEST_DIR = resolve(process.cwd(), '.test-memory-topic');

describe('memory/topic-store', () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('creates topic file and appends entry', async () => {
    const store = new MemoryTopicStore(TEST_DIR);
    const res = await store.appendEntry({
      name: 'user-role',
      description: '用户偏好',
      type: 'user',
      entry: '用户偏好简洁输出',
    });
    const raw = await readFile(resolve(TEST_DIR, res.file), 'utf-8');
    expect(raw).toContain('name: user-role');
    expect(raw).toContain('## Entries');
  });
});

