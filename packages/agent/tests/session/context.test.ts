/**
 * Session Context Pipeline 单元测试
 *
 * 测试范围：
 * 1. build_system_prompt — 带/不带 project_context、user_context
 * 2. build_skill_injection — 格式正确，包含 steps/pitfalls/verification
 * 3. build_related_skills_injection — 最多 3 个，截断多余
 * 4. (format_recent_messages removed — logic inlined into build_llm_context)
 * 5. build_llm_context — system + skill + recent 三段组合正确
 * 6. LLMContext 方法 — appendChunk / finalizeStream / finishAssistantMessage
 * 7. 无 skill 匹配时：走 fuzzy_match 路径
 * 8. session 无消息时：messages 仅含 system prompt
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  build_system_prompt,
  build_skill_injection,
  build_related_skills_injection,
  build_llm_context,
} from '../../src/session/context.js';
import type { Session, Skill } from '../../src/foundation/types.js';
import type { SkillRegistry } from '../../src/skills/registry.js';

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'test-session',
    messages: [],
    working_directory: '/tmp/test',
    created_at: Date.now(),
    last_active: Date.now(),
    add_message: vi.fn(),
    clear: vi.fn(),
    compact: vi.fn(),
    ...overrides,
  } as Session;
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1',
    name: 'Test Skill',
    trigger_condition: 'Run tests',
    steps: ['Step 1', 'Step 2'],
    pitfalls: ['Pitfall A'],
    verification: 'Run npm test',
    task_type: 'test',
    created_at: Date.now(),
    updated_at: Date.now(),
    call_count: 0,
    success_count: 0,
    ...overrides,
  };
}

// Minimal mock SkillRegistry
function makeSkillReg(): SkillRegistry {
  return {
    register: vi.fn(),
    register_manifest: vi.fn(),
    match: vi.fn().mockReturnValue(null),
    fuzzy_match: vi.fn().mockReturnValue([]),
    build_directory_listing: vi.fn().mockReturnValue(''),
    list: vi.fn(),
    show: vi.fn(),
    delete: vi.fn(),
  } as unknown as SkillRegistry;
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe('build_system_prompt', () => {
  it('includes base role definition', () => {
    const session = makeSession();
    const prompt = build_system_prompt(session);
    expect(prompt).toContain('Chromatopsia');
  });

  it('includes project_context when present', () => {
    const session = makeSession({
      project_context: {
        name: 'MyApp',
        root: '/home/user/myapp',
        language: 'TypeScript',
        framework: 'React',
        description: 'A test app',
      },
    });
    const prompt = build_system_prompt(session);
    expect(prompt).toContain('【项目】MyApp');
    expect(prompt).toContain('/home/user/myapp');
    expect(prompt).toContain('TypeScript');
    expect(prompt).toContain('React');
    expect(prompt).toContain('A test app');
  });

  it('omits project_context fields when not present', () => {
    const session = makeSession({ project_context: { name: 'OnlyName', root: '/root' } });
    const prompt = build_system_prompt(session);
    expect(prompt).toContain('【项目】OnlyName');
    expect(prompt).not.toContain('语言：');
    expect(prompt).not.toContain('框架：');
  });

  it('includes user_context when present', () => {
    const session = makeSession({
      user_context: { name: 'Alice', preferences: { theme: 'dark' } },
    });
    const prompt = build_system_prompt(session);
    expect(prompt).toContain('用户：Alice');
    expect(prompt).toContain('theme');
    expect(prompt).toContain('dark');
  });

  it('handles session with no context fields', () => {
    const session = makeSession();
    const prompt = build_system_prompt(session);
    expect(prompt).toContain('Chromatopsia');
    // Should not throw
    expect(() => build_system_prompt(session)).not.toThrow();
  });
});

describe('build_skill_injection', () => {
  it('contains skill name and trigger_condition', () => {
    const skill = makeSkill({ name: 'Git Commit', trigger_condition: 'Commit changes' });
    const block = build_skill_injection(skill);
    expect(block).toContain('【技能】Git Commit');
    expect(block).toContain('触发条件：Commit changes');
  });

  it('formats steps with numbers', () => {
    const skill = makeSkill({ steps: ['git add .', 'git commit -m "fix"'] });
    const block = build_skill_injection(skill);
    expect(block).toContain('1. git add .');
    expect(block).toContain('2. git commit -m "fix"');
  });

  it('includes pitfalls when present', () => {
    const skill = makeSkill({ pitfalls: ['Do not force push'] });
    const block = build_skill_injection(skill);
    expect(block).toContain('常见陷阱');
    expect(block).toContain('Do not force push');
  });

  it('includes verification when present', () => {
    const skill = makeSkill({ verification: 'git log --oneline' });
    const block = build_skill_injection(skill);
    expect(block).toContain('验证方法：git log --oneline');
  });

  it('omits verification line when absent', () => {
    const skill = makeSkill({ verification: undefined });
    const block = build_skill_injection(skill);
    expect(block).not.toContain('验证方法：');
  });
});

describe('build_related_skills_injection', () => {
  it('returns empty string for empty array', () => {
    expect(build_related_skills_injection([])).toBe('');
  });

  it('contains header and skill names', () => {
    const skills = [makeSkill({ name: 'Skill A' }), makeSkill({ name: 'Skill B' })];
    const block = build_related_skills_injection(skills);
    expect(block).toContain('【相关经验】');
    expect(block).toContain('Skill A');
    expect(block).toContain('Skill B');
  });

  it('limits to 3 skills', () => {
    const skills = [
      makeSkill({ name: 'S1' }),
      makeSkill({ name: 'S2' }),
      makeSkill({ name: 'S3' }),
      makeSkill({ name: 'S4' }),
      makeSkill({ name: 'S5' }),
    ];
    const block = build_related_skills_injection(skills);
    expect(block).toContain('S1');
    expect(block).toContain('S2');
    expect(block).toContain('S3');
    expect(block).not.toContain('S4');
    expect(block).not.toContain('S5');
  });
});


describe('build_llm_context', () => {
  it('returns LLMContext with messages array', () => {
    const session = makeSession();
    const reg = makeSkillReg();
    const ctx = build_llm_context(session, 'test', null, reg);
    expect(Array.isArray(ctx.messages)).toBe(true);
    expect(ctx.messages.length).toBeGreaterThan(0);
    expect(ctx.messages[0].role).toBe('system');
  });

  it('first message is system prompt', () => {
    const session = makeSession({ project_context: { name: 'P', root: '/' } });
    const reg = makeSkillReg();
    const ctx = build_llm_context(session, 'test', null, reg);
    expect(ctx.messages[0].role).toBe('system');
    expect(ctx.messages[0].content).toContain('【项目】P');
  });

  it('injects matched skill as system message', () => {
    const session = makeSession();
    const reg = makeSkillReg();
    const skill = makeSkill({ name: 'Run Tests', steps: ['npm test'] });
    const ctx = build_llm_context(session, 'test', skill, reg);
    const systemMessages = ctx.messages.filter((m) => m.role === 'system');
    const skillMsgs = systemMessages.filter((m) => m.content.includes('【技能】'));
    expect(skillMsgs.length).toBe(1);
    expect(skillMsgs[0].content).toContain('Run Tests');
  });

  it('uses fuzzy_match when no precise match', () => {
    const session = makeSession();
    const reg = makeSkillReg();
    (reg.fuzzy_match as ReturnType<typeof vi.fn>).mockReturnValue([
      makeSkill({ name: 'Fuzzy Skill' }),
    ]);
    const ctx = build_llm_context(session, 'unknown-task', null, reg);
    const systemMessages = ctx.messages.filter((m) => m.role === 'system');
    const relatedMsgs = systemMessages.filter((m) => m.content.includes('【相关经验】'));
    expect(relatedMsgs.length).toBe(1);
    expect(relatedMsgs[0].content).toContain('Fuzzy Skill');
  });

  it('appends recent messages as system block', () => {
    const session = makeSession({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'user', content: 'third' },
      ],
    });
    const reg = makeSkillReg();
    const ctx = build_llm_context(session, 'test', null, reg);
    const allContent = ctx.messages.map((m) => m.content).join('\n');
    expect(allContent).toContain('first');
    expect(allContent).toContain('second');
    expect(allContent).toContain('third');
  });

  it('empty session: messages only contain system prompt', () => {
    const session = makeSession({ messages: [] });
    const reg = makeSkillReg();
    const ctx = build_llm_context(session, 'test', null, reg);
    // Only the base system prompt (no recent messages block)
    expect(ctx.messages.length).toBe(1);
    expect(ctx.messages[0].role).toBe('system');
  });

  describe('LLMContext methods', () => {
    it('appendAssistantChunk accumulates chunks', () => {
      const session = makeSession();
      const reg = makeSkillReg();
      const ctx = build_llm_context(session, 'test', null, reg);
      ctx.appendAssistantChunk('Hello ');
      ctx.appendAssistantChunk('World');
      const response = ctx.finalizeStream();
      expect(response.content).toBe('Hello World');
    });

    it('finalizeStream returns stop reason', () => {
      const session = makeSession();
      const reg = makeSkillReg();
      const ctx = build_llm_context(session, 'test', null, reg);
      ctx.appendAssistantChunk('response text');
      const response = ctx.finalizeStream();
      expect(response.finish_reason).toBe('stop');
    });

    it('showNotification does not throw', () => {
      const session = makeSession();
      const reg = makeSkillReg();
      const ctx = build_llm_context(session, 'test', null, reg);
      expect(() => ctx.showNotification('test')).not.toThrow();
    });

    it('finishAssistantMessage calls session.add_message', () => {
      const session = makeSession();
      const reg = makeSkillReg();
      const ctx = build_llm_context(session, 'test', null, reg);
      ctx.finishAssistantMessage('final response');
      expect(session.add_message).toHaveBeenCalledWith({ role: 'assistant', content: 'final response' });
    });
  });
});
