import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm } from 'fs/promises';
import { resolve } from 'path';
import { MemoryIndexStore } from '../../src/memory/index-store.js';

const TEST_DIR = resolve(process.cwd(), '.test-memory-index');

describe('memory/index-store', () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('creates MEMORY.md on ensure', async () => {
    const store = new MemoryIndexStore(TEST_DIR);
    await store.ensure();
    const raw = await store.readRaw();
    expect(raw).toContain('# MEMORY');
  });

  it('upserts entries into MEMORY.md index', async () => {
    const store = new MemoryIndexStore(TEST_DIR);
    await store.ensure();
    await store.upsertEntry({
      name: 'user-role',
      file: 'user-role.md',
      description: '用户偏好简洁',
      type: 'user',
    });
    const list = await store.listEntries();
    expect(list.some((e) => e.name === 'user-role')).toBe(true);
  });
});

