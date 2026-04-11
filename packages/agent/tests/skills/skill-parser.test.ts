import { describe, it, expect } from 'vitest';
import { parseSkillMarkdown, serializeSkillMarkdown } from '../../src/skills/skill-parser.js';
import type { Skill, SkillManifestEntry } from '../../src/foundation/types.js';

describe('skills/skill-parser', () => {
  it('parses frontmatter and sections into manifest and skill', () => {
    const raw = `---
id: test-skill
name: Test Skill
description: test description
triggers:
  - foo
  - bar
trigger_pattern: "foo.*bar"
trigger_condition: trigger text
task_type: test
scope: user
enabled: true
priority: 70
version: 2
updated_at: 2026-04-11T00:00:00.000Z
created_at: 2026-04-10T00:00:00.000Z
call_count: 1
success_count: 1
---

## 适用场景
- sample

## 操作步骤
1. step one
2. step two

## 注意事项
- pitfall one

## 验证方式
- verify`;

    const parsed = parseSkillMarkdown(raw, '.chromatopsia/skills/user/test-skill.md');
    expect(parsed).not.toBeNull();
    expect(parsed!.manifest.id).toBe('test-skill');
    expect(parsed!.manifest.triggers).toEqual(['foo', 'bar']);
    expect(parsed!.skill.steps).toEqual(['step one', 'step two']);
    expect(parsed!.skill.pitfalls).toEqual(['pitfall one']);
    expect(parsed!.skill.verification).toContain('verify');
  });

  it('serializes manifest and skill to markdown', () => {
    const manifest: SkillManifestEntry = {
      id: 'serialize-skill',
      name: 'Serialize Skill',
      description: 'serialize desc',
      triggers: ['trigger'],
      task_type: 'general',
      scope: 'user',
      enabled: true,
      priority: 50,
      version: 1,
      updated_at: '2026-04-11T00:00:00.000Z',
      source_path: '.chromatopsia/skills/user/serialize-skill.md',
    };
    const skill: Skill = {
      id: 'serialize-skill',
      name: 'Serialize Skill',
      trigger_condition: 'trigger',
      steps: ['do a', 'do b'],
      pitfalls: ['avoid c'],
      verification: 'check d',
      task_type: 'general',
      created_at: Date.now(),
      updated_at: Date.now(),
      call_count: 0,
      success_count: 0,
    };

    const markdown = serializeSkillMarkdown(manifest, skill);
    expect(markdown).toContain('id: serialize-skill');
    expect(markdown).toContain('## 操作步骤');
    expect(markdown).toContain('1. do a');
  });
});
