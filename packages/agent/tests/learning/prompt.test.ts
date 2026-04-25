import { describe, expect, it } from 'vitest';
import { buildLearningJudgePrompt } from '../../src/learning/prompt.js';

describe('learning/prompt', () => {
  it('builds a stable judge prompt with create/patch/skip contract', () => {
    const prompt = buildLearningJudgePrompt({
      lastTaskType: 'git',
      bufferSummary: '[1] git: tool_count=5; errors=1; outcome=success; complexity=complex; tools=run_shell',
      existingSkillInfo: 'Existing related Skill: "Git Review" (id=git-review).',
      generatedAt: '2026-04-25T00:00:00.000Z',
    });

    expect(prompt).toContain('You are the Learning Judge');
    expect(prompt).toContain('"decision": "create"');
    expect(prompt).toContain('"create", "patch", or "skip"');
    expect(prompt).toContain('5+ tool calls');
    expect(prompt).toContain('tricky error');
    expect(prompt).toContain('Existing related Skill');
    expect(prompt).toContain('target_skill_id');
    expect(prompt).toContain('task_type: git');
    expect(prompt).toContain('updated_at: 2026-04-25T00:00:00.000Z');
  });
});
