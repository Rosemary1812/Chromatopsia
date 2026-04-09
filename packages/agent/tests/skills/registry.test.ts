/**
 * SkillRegistry 单元测试
 *
 * 测试范围：
 * 1. register / match 精确匹配 task_type
 * 2. match 返回 null（未知 task_type）
 * 3. fuzzy_match 搜索 trigger_condition / name
 * 4. register 重复 id 覆盖
 * 5. list / show / delete / search 正确
 * 6. update 更新 fields
 * 7. 空注册表行为
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SkillRegistry } from '../../src/skills/registry.js';
import type { Skill } from '../../src/types.js';

const makeSkill = (overrides: Partial<Skill> = {}): Skill => ({
  id: 'skill-001',
  name: 'Git Rebase',
  task_type: 'git-rebase',
  trigger_condition: 'clean up commit history',
  steps: ['git rebase -i HEAD~N', 'resolve conflicts'],
  pitfalls: ['do not rebase pushed commits'],
  created_at: 1700000000000,
  updated_at: 1700000000000,
  call_count: 0,
  success_count: 0,
  ...overrides,
});

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  describe('register + match', () => {
    it('registers a skill and matches by task_type', () => {
      const skill = makeSkill();
      registry.register(skill);
      expect(registry.match('git-rebase')).toBe(skill);
    });

    it('returns null for unknown task_type', () => {
      registry.register(makeSkill());
      expect(registry.match('unknown')).toBeNull();
    });

    it('overwrites existing skill with same id', () => {
      const first = makeSkill({ id: 's1', name: 'Original' });
      const second = makeSkill({ id: 's1', name: 'Updated' });
      registry.register(first);
      registry.register(second);
      expect(registry.match('git-rebase')?.name).toBe('Updated');
    });

    it('handles multiple skills with same task_type', () => {
      registry.register(makeSkill({ id: 's1', name: 'First' }));
      registry.register(makeSkill({ id: 's2', name: 'Second' }));
      // match returns the first one registered
      const matched = registry.match('git-rebase');
      expect(matched).not.toBeNull();
      expect(['First', 'Second']).toContain(matched!.name);
    });
  });

  describe('fuzzy_match', () => {
    beforeEach(() => {
      registry.register(
        makeSkill({
          id: 's1',
          name: 'Git Rebase',
          task_type: 'git-rebase',
          trigger_condition: 'clean up commit history',
        }),
      );
      registry.register(
        makeSkill({
          id: 's2',
          name: 'Run Tests',
          task_type: 'test-debug',
          trigger_condition: 'debug failing tests',
        }),
      );
    });

    it('matches trigger_condition keyword', () => {
      const results = registry.fuzzy_match('commit history');
      expect(results.some((s) => s.id === 's1')).toBe(true);
    });

    it('matches name keyword', () => {
      const results = registry.fuzzy_match('Rebase');
      expect(results.some((s) => s.id === 's1')).toBe(true);
    });

    it('is case-insensitive', () => {
      const results = registry.fuzzy_match('GIT');
      expect(results.some((s) => s.id === 's1')).toBe(true);
    });

    it('returns empty array for no match', () => {
      expect(registry.fuzzy_match('xyzzy')).toHaveLength(0);
    });
  });

  describe('list / show / delete', () => {
    it('list prints all skills', () => {
      const consoleMock = vi.spyOn(console, 'log').mockImplementation(() => {});
      registry.register(makeSkill({ id: 's1', name: 'Skill A' }));
      registry.register(makeSkill({ id: 's2', name: 'Skill B', task_type: 'other' }));
      registry.list();
      expect(consoleMock).toHaveBeenCalledWith(
        'Skill A (git-rebase)\nSkill B (other)',
      );
      consoleMock.mockRestore();
    });

    it('list prints empty message when no skills', () => {
      const consoleMock = vi.spyOn(console, 'log').mockImplementation(() => {});
      registry.list();
      expect(consoleMock).toHaveBeenCalledWith('No skills registered.');
      consoleMock.mockRestore();
    });

    it('show prints skill JSON', () => {
      const consoleMock = vi.spyOn(console, 'log').mockImplementation(() => {});
      registry.register(makeSkill({ id: 's1', name: 'Git Rebase' }));
      registry.show('Git Rebase');
      expect(consoleMock).toHaveBeenCalled();
      const printed = consoleMock.mock.calls[0][0] as string;
      expect(JSON.parse(printed)).toMatchObject({ name: 'Git Rebase', id: 's1' });
      consoleMock.mockRestore();
    });

    it('show prints not found for unknown skill', () => {
      const consoleMock = vi.spyOn(console, 'log').mockImplementation(() => {});
      registry.show('NonExistent');
      expect(consoleMock).toHaveBeenCalledWith('Skill "NonExistent" not found.');
      consoleMock.mockRestore();
    });

    it('delete removes skill by name', () => {
      registry.register(makeSkill({ id: 's1', name: 'Git Rebase' }));
      registry.delete('Git Rebase');
      expect(registry.match('git-rebase')).toBeNull();
    });

    it('delete does not throw for unknown skill', () => {
      expect(() => registry.delete('NonExistent')).not.toThrow();
    });
  });

  describe('update', () => {
    it('updates skill fields and updated_at', () => {
      registry.register(makeSkill({ id: 's1', name: 'Original' }));
      const before = Date.now();
      registry.update('s1', { name: 'Updated', call_count: 5 });
      const skill = registry.getById('s1');
      expect(skill?.name).toBe('Updated');
      expect(skill?.call_count).toBe(5);
      expect(skill!.updated_at).toBeGreaterThanOrEqual(before);
    });

    it('does nothing for unknown id', () => {
      expect(() => registry.update('unknown', { name: 'X' })).not.toThrow();
    });
  });

  describe('search', () => {
    it('prints fuzzy_match results', () => {
      const consoleMock = vi.spyOn(console, 'log').mockImplementation(() => {});
      registry.register(
        makeSkill({ id: 's1', name: 'Git Rebase', trigger_condition: 'clean history' }),
      );
      registry.search('history');
      expect(consoleMock).toHaveBeenCalledWith('Git Rebase — clean history');
      consoleMock.mockRestore();
    });

    it('prints not found for empty results', () => {
      const consoleMock = vi.spyOn(console, 'log').mockImplementation(() => {});
      registry.search('nonexistent');
      expect(consoleMock).toHaveBeenCalledWith('No skills found for "nonexistent".');
      consoleMock.mockRestore();
    });
  });

  describe('getAll / getById', () => {
    it('getAll returns all registered skills', () => {
      registry.register(makeSkill({ id: 's1' }));
      registry.register(makeSkill({ id: 's2' }));
      expect(registry.getAll()).toHaveLength(2);
    });

    it('getById returns skill by id', () => {
      registry.register(makeSkill({ id: 's1', name: 'Target' }));
      expect(registry.getById('s1')?.name).toBe('Target');
    });

    it('getById returns undefined for unknown id', () => {
      expect(registry.getById('unknown')).toBeUndefined();
    });
  });
});
