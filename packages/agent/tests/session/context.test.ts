/**
 * Session Context Pipeline 单元测试
 *
 * 测试范围：
 * 1. build_system_prompt — 带/不带 project_context、user_context
 * 2. Skill directory listing — exposes lightweight skill metadata only
 * 3. build_llm_context — system + skill directory + recent history
 * 4. LLMContext 方法 — appendChunk / finalizeStream / finishAssistantMessage
 * 5. session 无消息时：messages 仅含 system prompt
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  build_system_prompt,
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

  it('does not inject matched or fuzzy skill bodies automatically', () => {
    const session = makeSession();
    const reg = makeSkillReg();
    (reg.fuzzy_match as ReturnType<typeof vi.fn>).mockReturnValue([makeSkill({ name: 'Fuzzy Skill' })]);
    const ctx = build_llm_context(session, 'unknown-task', makeSkill({ name: 'Run Tests' }), reg);
    const allContent = ctx.messages.map((m) => m.content).join('\n');
    expect(allContent).not.toContain('【技能】');
    expect(allContent).not.toContain('【相关经验】');
    expect(allContent).not.toContain('Fuzzy Skill');
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

  it('preserves persisted summary system messages from session history', () => {
    const session = makeSession({
      messages: [
        { role: 'system', content: '【历史摘要】之前已经完成 API 设计' },
        { role: 'user', content: '继续实现' },
      ],
    });
    const reg = makeSkillReg();
    const ctx = build_llm_context(session, 'test', null, reg);
    expect(ctx.messages.some((m) => m.role === 'system' && m.content.includes('【历史摘要】'))).toBe(true);
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
