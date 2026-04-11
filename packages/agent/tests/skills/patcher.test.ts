/**
 * SkillPatcher 单元测试
 *
 * 测试范围：
 * 1. patch 追加 new_pitfalls
 * 2. patch 合并 corrections 到 steps
 * 3. patch 更新 updated_at
 * 4. patch 递增 call_count
 * 5. patch 不重复追加相同的 pitfalls
 * 6. 边界：空 failed_buffer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SkillPatcher } from '../../src/skills/patcher.js';
import type { Skill, TaskBufferEntry, ToolResult } from '../../src/foundation/types.js';

const makeSkill = (overrides: Partial<Skill> = {}): Skill => ({
  id: 'skill-001',
  name: 'Git Rebase',
  task_type: 'git-rebase',
  trigger_condition: 'clean up commit history',
  steps: ['git rebase -i HEAD~3'],
  pitfalls: ['original pitfall'],
  created_at: 1700000000000,
  updated_at: 1700000000000,
  call_count: 0,
  success_count: 0,
  ...overrides,
});

const makeToolResult = (output: string): ToolResult => ({
  tool_call_id: 'tc-1',
  output,
  success: output.startsWith('ok') || output.startsWith('OK'),
});

const makeBufferEntry = (
  toolNames: string[],
  outputs: ToolResult[],
  taskType = 'git-rebase',
): TaskBufferEntry => ({
  tool_calls: toolNames.map((name, i) => ({ id: `tc-${i}`, name, arguments: {} })),
  tool_results: outputs,
  task_type: taskType,
  session_id: 'session-1',
  timestamp: Date.now(),
});

describe('SkillPatcher', () => {
  let patcher: SkillPatcher;

  beforeEach(() => {
    patcher = new SkillPatcher();
  });

  describe('patch', () => {
    it('appends new pitfalls from failed buffer', async () => {
      const skill = makeSkill();
      const buffer = [
        makeBufferEntry(
          ['git'],
          [makeToolResult('merge conflict detected')],
        ),
      ];

      await patcher.patch(skill, buffer);

      expect(skill.pitfalls).toContain('存在冲突，请先解决冲突再继续');
    });

    it('merges corrections into steps', async () => {
      const skill = makeSkill();
      const buffer = [
        makeBufferEntry(
          ['git'],
          [makeToolResult('merge conflict detected')],
        ),
      ];

      await patcher.patch(skill, buffer);

      expect(skill.steps).toContain(
        '遇到冲突时，先用 git status 查看冲突文件，人工解决后再执行后续操作',
      );
    });

    it('updates updated_at', async () => {
      const skill = makeSkill({ updated_at: 1000 });
      const buffer = [makeBufferEntry(['git'], [makeToolResult('error')])];
      const before = Date.now();

      await patcher.patch(skill, buffer);

      expect(skill.updated_at).toBeGreaterThanOrEqual(before);
    });

    it('increments call_count', async () => {
      const skill = makeSkill({ call_count: 3 });
      const buffer = [makeBufferEntry(['git'], [makeToolResult('ok')])];

      await patcher.patch(skill, buffer);

      expect(skill.call_count).toBe(4);
    });

    it('does not duplicate existing pitfalls', async () => {
      const skill = makeSkill({
        pitfalls: ['存在冲突，请先解决冲突再继续'],
      });
      const buffer = [
        makeBufferEntry(['git'], [makeToolResult('merge conflict detected')]),
      ];

      await patcher.patch(skill, buffer);

      const conflictPitfalls = skill.pitfalls.filter(
        (p) => p === '存在冲突，请先解决冲突再继续',
      );
      expect(conflictPitfalls).toHaveLength(1);
    });

    it('handles empty failed_buffer', async () => {
      const skill = makeSkill({ pitfalls: ['existing'], call_count: 0 });
      const before = skill.updated_at;

      await patcher.patch(skill, []);

      expect(skill.pitfalls).toEqual(['existing']);
      expect(skill.call_count).toBe(1);
      expect(skill.updated_at).toBeGreaterThanOrEqual(before);
    });

    it('adds git status pitfall on git errors', async () => {
      const skill = makeSkill({ pitfalls: [] });
      const buffer = [
        makeBufferEntry(['git'], [makeToolResult('fatal: something went wrong')]),
      ];

      await patcher.patch(skill, buffer);

      expect(skill.pitfalls).toContain(
        'git 操作失败时，用 git status 和 git log 查看当前状态',
      );
    });

    it('adds resource-not-found pitfall', async () => {
      const skill = makeSkill({ pitfalls: [] });
      const buffer = [
        makeBufferEntry(['Read'], [makeToolResult('file not found')]),
      ];

      await patcher.patch(skill, buffer);

      expect(skill.pitfalls).toContain('操作前请确认目标文件或资源存在');
    });

    it('adds permission pitfall', async () => {
      const skill = makeSkill({ pitfalls: [] });
      const buffer = [
        makeBufferEntry(['run_shell'], [makeToolResult('permission denied')]),
      ];

      await patcher.patch(skill, buffer);

      expect(skill.pitfalls).toContain(
        '注意权限问题，必要时使用 sudo 或检查文件权限',
      );
    });

    it('adds timeout pitfall', async () => {
      const skill = makeSkill({ pitfalls: [] });
      const buffer = [
        makeBufferEntry(['run_shell'], [makeToolResult('request timeout')]),
      ];

      await patcher.patch(skill, buffer);

      expect(skill.pitfalls).toContain(
        '操作可能超时，建议增加 timeout 参数或分步执行',
      );
    });
  });
});
