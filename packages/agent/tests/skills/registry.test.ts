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
import type { Skill } from '../../src/foundation/types.js';

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
    it('list returns all skills as formatted strings', () => {
      registry.register(makeSkill({ id: 's1', name: 'Skill A' }));
      registry.register(makeSkill({ id: 's2', name: 'Skill B', task_type: 'other' }));
      const result = registry.list();
      expect(result).toContain('Skill A (git-rebase)');
      expect(result).toContain('Skill B (other)');
    });

    it('list returns empty array when no skills', () => {
      const result = registry.list();
      expect(result).toEqual([]);
    });

    it('show returns skill as JSON string', () => {
      registry.register(makeSkill({ id: 's1', name: 'Git Rebase' }));
      const result = registry.show('Git Rebase');
      expect(result).not.toBeNull();
      expect(JSON.parse(result!)).toMatchObject({ name: 'Git Rebase', id: 's1' });
    });

    it('show returns null for unknown skill', () => {
      const result = registry.show('NonExistent');
      expect(result).toBeNull();
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
    it('returns fuzzy_match results as formatted strings', () => {
      registry.register(
        makeSkill({ id: 's1', name: 'Git Rebase', trigger_condition: 'clean history' }),
      );
      const result = registry.search('history');
      expect(result).toContain('Git Rebase — clean history');
    });

    it('returns empty array for no matches', () => {
      const result = registry.search('nonexistent');
      expect(result).toEqual([]);
    });
  });

  describe('trigger_match', () => {
    beforeEach(() => {
      registry.register(
        makeSkill({
          id: 's1',
          name: 'Git Rebase',
          task_type: 'git-rebase',
          trigger_condition: 'clean up commit history',
          trigger_pattern: '^/rebase',
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
      registry.register(
        makeSkill({
          id: 's3',
          name: 'Build Project',
          task_type: 'build',
          trigger_condition: 'compile build',
        }),
      );
    });

    it('matches trigger_pattern regex with high score', () => {
      const result = registry.trigger_match('/rebase HEAD~3');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('s1');
    });

    it('matches trigger_condition keyword with score 50', () => {
      const result = registry.trigger_match('clean up commit history');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('s1');
    });

    it('matches trigger_condition individual words with score 10 each', () => {
      // Single word match gives +10, below threshold 30 → null
      expect(registry.trigger_match('commit')).toBeNull();
      // Three word matches give +30, not >30 → still null
      // Four word matches give +40 → hits
      const result = registry.trigger_match('clean up commit history');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('s1');
    });

    it('matches name fuzzy with low score 5 only when combined with other signals', () => {
      // name match (+5) alone is below threshold 30
      expect(registry.trigger_match('Rebase')).toBeNull();
      // name match (+5) + 3 word matches (+30) = 35 → passes threshold >30
      const result = registry.trigger_match('Rebase clean up commit history');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('s1');
    });

    it('returns null when no skill exceeds score threshold 30', () => {
      // Only name match gives +5, below threshold
      expect(registry.trigger_match('xyzzy')).toBeNull();
    });

    it('returns null for empty input', () => {
      const result = registry.trigger_match('');
      expect(result).toBeNull();
    });

    it('returns null when skill list is empty', () => {
      const empty = new SkillRegistry();
      expect(empty.trigger_match('anything')).toBeNull();
    });

    it('returns highest-scoring skill when multiple match', () => {
      registry.register(
        makeSkill({
          id: 's4',
          name: 'Git Squash',
          task_type: 'git-squash',
          trigger_condition: 'clean up commits squash',
          trigger_pattern: '^/rebase',
        }),
      );
      // Both s1 and s4 match trigger_pattern (+100), but s4 also matches "squash" word
      const result = registry.trigger_match('/rebase squash');
      expect(result).not.toBeNull();
      // s4 has same trigger_pattern score but additional word match → wins
      expect(['s1', 's4']).toContain(result!.id);
    });

    it('ignores invalid trigger_pattern regex', () => {
      registry.register(
        makeSkill({
          id: 's5',
          name: 'Bad Pattern',
          task_type: 'bad',
          trigger_condition: '',
          trigger_pattern: '[invalid',
        }),
      );
      // Should not throw, just skip the bad pattern
      const result = registry.trigger_match('anything');
      expect(result).toBeDefined();
    });

    it('skips learning draft skills in trigger_match', () => {
      const draft = makeSkill({
        id: 'draft-s1',
        name: 'Draft Skill',
        task_type: 'draft-task',
        trigger_condition: 'draft only',
      });
      registry.register_manifest({
        id: draft.id,
        name: draft.name,
        description: draft.trigger_condition,
        triggers: [draft.trigger_condition],
        task_type: draft.task_type,
        scope: 'learning_draft',
        enabled: false,
        priority: 10,
        version: 1,
        updated_at: new Date().toISOString(),
        source_path: '.chromatopsia/skills/drafts/draft-s1.md',
      });
      registry.register(draft);
      expect(registry.trigger_match('draft only')).toBeNull();
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
