import { describe, it, expect } from 'vitest';
import { parseSkillMarkdown, serializeSkillMarkdown } from '../../src/skills/skill-parser.js';
import type { Skill, SkillManifestEntry } from '../../src/foundation/types.js';

describe('skills/skill-parser', () => {
  it('parses only frontmatter metadata and preserves markdown body', () => {
    const raw = `---
id: test-skill
name: Test Skill
description: test description
user-invocable: true
context: inline
paths:
  - "**/*.ts"
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

    const parsed = parseSkillMarkdown(raw, '.chromatopsia/skills/user/test-skill/SKILL.md');
    expect(parsed).not.toBeNull();
    expect(parsed!.manifest.id).toBe('test-skill');
    expect(parsed!.manifest.triggers).toEqual(['foo', 'bar']);
    expect(parsed!.manifest.userInvocable).toBe(true);
    expect(parsed!.manifest.context).toBe('inline');
    expect(parsed!.manifest.paths).toEqual(['**/*.ts']);
    expect(parsed!.body).toContain('## 操作步骤');
    expect(parsed!.body).toContain('1. step one');
    expect(parsed!.skill.steps).toEqual([]);
    expect(parsed!.skill.pitfalls).toEqual([]);
    expect(parsed!.skill.verification).toBeUndefined();
  });

  it('serializes manifest and guidance body to SKILL.md', () => {
    const manifest: SkillManifestEntry = {
      id: 'serialize-skill',
      name: 'Serialize Skill',
      description: 'serialize desc',
      userInvocable: true,
      context: 'inline',
      triggers: ['trigger'],
      task_type: 'general',
      scope: 'user',
      enabled: true,
      priority: 50,
      version: 1,
      updated_at: '2026-04-11T00:00:00.000Z',
      sourcePath: '.chromatopsia/skills/user/serialize-skill/SKILL.md',
      source_path: '.chromatopsia/skills/user/serialize-skill/SKILL.md',
    };
    const body = '# Serialize Skill\n\n## Procedure\nUse prose guidance, not executable macro steps.';

    const markdown = serializeSkillMarkdown(manifest, body);
    expect(markdown).toContain('id: serialize-skill');
    expect(markdown).toContain('user-invocable: true');
    expect(markdown).toContain('## Procedure');
    expect(markdown).toContain('Use prose guidance');
  });

  it('keeps legacy Skill serialization as prose guidance, not macro steps', () => {
    const manifest: SkillManifestEntry = {
      id: 'legacy-skill',
      name: 'Legacy Skill',
      description: 'legacy desc',
      userInvocable: true,
      context: 'inline',
      triggers: ['trigger'],
      task_type: 'general',
      scope: 'user',
      enabled: true,
      priority: 50,
      version: 1,
      updated_at: '2026-04-11T00:00:00.000Z',
      sourcePath: '.chromatopsia/skills/user/legacy-skill/SKILL.md',
      source_path: '.chromatopsia/skills/user/legacy-skill/SKILL.md',
    };
    const skill: Skill = {
      id: 'legacy-skill',
      name: 'Legacy Skill',
      trigger_condition: 'trigger',
      steps: ['Read file_path=a.ts'],
      pitfalls: [],
      task_type: 'general',
      created_at: Date.now(),
      updated_at: Date.now(),
      call_count: 0,
      success_count: 0,
    };

    const markdown = serializeSkillMarkdown(manifest, skill);
    expect(markdown).toContain('## Procedure');
    expect(markdown).not.toContain('Read file_path=a.ts');
  });
});
