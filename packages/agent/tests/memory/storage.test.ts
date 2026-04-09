/**
 * SkillStore 单元测试
 *
 * 测试范围：
 * 1. load/save 循环正确
 * 2. delete 从磁盘移除
 * 3. fuzzySearch 三种匹配都正确（task_type / trigger_condition / name）
 * 4. 不区分大小写
 * 5. skills.json 不存在时创建空数组
 * 6. skills.json 格式损坏时返回空数组
 * 7. byTaskType 精确匹配
 * 8. 所有操作在临时目录中进行
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm } from 'fs/promises';
import { resolve } from 'path';
import { SkillStore } from '../../src/memory/storage.js';
import type { Skill } from '../../src/types.js';

const TEST_DIR = resolve(process.cwd(), '.test-skill-store-temp');

let store: SkillStore;

const makeSkill = (overrides: Partial<Skill> = {}): Skill => ({
  id: 'skill-test-001',
  name: 'Test Skill',
  task_type: 'test-task',
  trigger_condition: 'run tests',
  steps: ['step1', 'step2'],
  pitfalls: ['pitfall1'],
  created_at: Date.now(),
  updated_at: Date.now(),
  call_count: 0,
  success_count: 0,
  ...overrides,
});

beforeEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
  store = new SkillStore(TEST_DIR);
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('SkillStore', () => {
  describe('load / save', () => {
    it('saves a skill and loads it back', async () => {
      const skill = makeSkill({ id: 's1', name: 'Git Rebase' });
      await store.save(skill);
      const loaded = new SkillStore(TEST_DIR);
      await loaded.load();
      expect(loaded.getAll()).toHaveLength(1);
      expect(loaded.getAll()[0].name).toBe('Git Rebase');
    });

    it('persists multiple skills', async () => {
      await store.save(makeSkill({ id: 's1' }));
      await store.save(makeSkill({ id: 's2' }));
      const loaded = new SkillStore(TEST_DIR);
      await loaded.load();
      expect(loaded.getAll()).toHaveLength(2);
    });

    it('overwrites existing skill with same id', async () => {
      await store.save(makeSkill({ id: 's1', name: 'Original' }));
      await store.save(makeSkill({ id: 's1', name: 'Updated' }));
      const loaded = new SkillStore(TEST_DIR);
      await loaded.load();
      expect(loaded.getAll()).toHaveLength(1);
      expect(loaded.getAll()[0].name).toBe('Updated');
    });
  });

  describe('delete', () => {
    it('removes skill from storage', async () => {
      await store.save(makeSkill({ id: 's1' }));
      await store.delete('s1');
      const loaded = new SkillStore(TEST_DIR);
      await loaded.load();
      expect(loaded.getAll()).toHaveLength(0);
    });
  });

  describe('getAll', () => {
    it('returns all skills', async () => {
      await store.save(makeSkill({ id: 's1' }));
      await store.save(makeSkill({ id: 's2' }));
      expect(store.getAll()).toHaveLength(2);
    });
  });

  describe('byTaskType', () => {
    it('returns skills matching exact task_type', async () => {
      await store.save(makeSkill({ id: 's1', task_type: 'git-rebase' }));
      await store.save(makeSkill({ id: 's2', task_type: 'test-debug' }));
      expect(store.byTaskType('git-rebase')).toHaveLength(1);
      expect(store.byTaskType('git-rebase')[0].id).toBe('s1');
    });

    it('returns empty array for unknown task_type', async () => {
      await store.save(makeSkill({ id: 's1', task_type: 'git-rebase' }));
      expect(store.byTaskType('unknown')).toHaveLength(0);
    });
  });

  describe('fuzzySearch', () => {
    beforeEach(async () => {
      await store.save(
        makeSkill({
          id: 's1',
          name: 'Git Rebase',
          task_type: 'git-rebase',
          trigger_condition: 'clean up commit history',
        }),
      );
      await store.save(
        makeSkill({
          id: 's2',
          name: 'Run Tests',
          task_type: 'test-debug',
          trigger_condition: 'debug failing tests',
        }),
      );
    });

    it('matches task_type', () => {
      const results = store.fuzzySearch('git-rebase');
      expect(results.some((s) => s.id === 's1')).toBe(true);
    });

    it('matches trigger_condition keyword', () => {
      const results = store.fuzzySearch('commit history');
      expect(results.some((s) => s.id === 's1')).toBe(true);
    });

    it('matches name', () => {
      const results = store.fuzzySearch('Rebase');
      expect(results.some((s) => s.id === 's1')).toBe(true);
    });

    it('is case-insensitive', () => {
      const results = store.fuzzySearch('GIT');
      expect(results.some((s) => s.id === 's1')).toBe(true);
    });

    it('returns empty for no match', () => {
      expect(store.fuzzySearch('xyzzy')).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('handles missing skills.json as empty store', async () => {
      await store.load();
      expect(store.getAll()).toHaveLength(0);
    });

    it('handles malformed JSON as empty store', async () => {
      const { writeFile, mkdir } = await import('fs/promises');
      await mkdir(resolve(TEST_DIR, '.chromatopsia'), { recursive: true });
      await writeFile(resolve(TEST_DIR, '.chromatopsia', 'skills.json'), '{ invalid json }', 'utf-8');
      await store.load();
      expect(store.getAll()).toHaveLength(0);
    });
  });
});
